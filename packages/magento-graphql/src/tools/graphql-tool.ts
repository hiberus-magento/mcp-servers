// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The one factory every `magentographql_*` tool is built through, so these guarantees are
// written once instead of thirty times:
//
//   - every input schema is strict, and `invoke` rejects an unknown argument;
//   - a curated tool has a FIXED document and passes its arguments only as GraphQL variables,
//     never spliced into the text, so a SKU or a search term cannot change the query. The
//     document is the output allowlist: only what it selects can reach a caller (design D3);
//   - the operation kind of the document is checked when the tool is BUILT. A read tool holding a
//     mutation, or a tool with two operations, stops the server at startup instead of surfacing on a call;
//   - annotations come from the kind of effect, not from hand-typed booleans — `readOnlyHint` is
//     what makes an MCP client skip a confirmation prompt;
//   - the client is resolved lazily, per call, so `tools/list` works before the base URL is set.
import { defineTool, type RegisteredTool, type ToolAnnotations } from "@hiberus-magento/mcp-core";
import type { z } from "zod";
import { OperationGuardError, inspectDocument, type GraphqlResult, type MagentoGraphqlClient } from "../client/index.js";
import { LIVE_VERIFIED_TOOLS, UNVERIFIED_DETAIL, UNVERIFIED_MARKER } from "./verification.js";

export type Access = "read" | "write";

/**
 * What a write does, which fixes its hints: `create` adds a record (not destructive, not idempotent),
 * `update` overwrites one (destructive, idempotent), `delete` removes one (destructive, idempotent),
 * `action` changes state with side effects (destructive, NOT idempotent: twice is not the same as once).
 */
export type WriteEffect = "create" | "update" | "delete" | "action";

/** `document` is the fixed document of a curated tool (absent on the generic query tool); tests read it, a server never needs to. */
export type MagentoGraphqlTool = RegisteredTool<z.ZodObject, unknown> & { readonly access: Access; readonly document?: string };

type ToolName = `magentographql_${string}`;

interface ToolSpecBase<S extends z.ZodObject> {
  readonly name: ToolName;
  readonly description: string;
  readonly input: S;
  /** One operation; its kind must match the factory method it is given to. */
  readonly document: string;
  readonly variables?: (args: z.infer<S>) => Record<string, unknown>;
  /** A top-level field of `data` to return instead of all of it. */
  readonly pick?: string;
  /** Shapes the picked value, e.g. to say "nothing matched" instead of returning an empty list. Runs before errors are attached. */
  readonly transform?: (value: unknown, args: z.infer<S>) => unknown;
  readonly context?: (args: z.infer<S>) => { readonly store?: string | undefined; readonly currency?: string | undefined };
}

export type ReadToolSpec<S extends z.ZodObject> = ToolSpecBase<S>;

export interface WriteToolSpec<S extends z.ZodObject> extends ToolSpecBase<S> {
  readonly effect: WriteEffect;
}

/** A tool whose document comes from the caller. It is read-only because `client.query()` refuses anything but one query. */
export interface DynamicQuerySpec<S extends z.ZodObject> {
  readonly name: ToolName;
  readonly description: string;
  readonly input: S;
  readonly run: (args: z.infer<S>, client: MagentoGraphqlClient) => Promise<GraphqlResult>;
}

export interface ToolFactory {
  dynamicQueryTool<S extends z.ZodObject>(spec: DynamicQuerySpec<S>): MagentoGraphqlTool;
  readTool<S extends z.ZodObject>(spec: ReadToolSpec<S>): MagentoGraphqlTool;
  writeTool<S extends z.ZodObject>(spec: WriteToolSpec<S>): MagentoGraphqlTool;
}

export const READ_ONLY_ANNOTATIONS: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

export const WRITE_ANNOTATIONS: Readonly<Record<WriteEffect, ToolAnnotations>> = {
  create: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  delete: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  action: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
};

export interface ToolFactoryOptions {
  /** Tool names run against a real instance; defaults to `LIVE_VERIFIED_TOOLS`. Injectable for tests. */
  readonly liveVerified?: ReadonlySet<string>;
}

/** What a caller receives: the picked data, or — when Magento reported errors next to partial data — both. */
export function shapeResult(result: GraphqlResult, pick: string | undefined, transform?: (value: unknown) => unknown): unknown {
  const record = result.data !== null && typeof result.data === "object" ? (result.data as Record<string, unknown>) : {};
  const picked = pick === undefined ? result.data : (record[pick] ?? null);
  const value = transform !== undefined ? transform(picked) : picked;
  return result.errors !== undefined ? { data: value, errors: result.errors } : value;
}

export function createToolFactory(getClient: () => MagentoGraphqlClient, options: ToolFactoryOptions = {}): ToolFactory {
  const liveVerified = options.liveVerified ?? LIVE_VERIFIED_TOOLS;

  function build<S extends z.ZodObject>(spec: ToolSpecBase<S>, annotations: ToolAnnotations, access: Access): MagentoGraphqlTool {
    const info = inspectDocument(spec.document);
    const expected = access === "read" ? "query" : "mutation";
    if (info.operations !== 1 || info.kind !== expected) {
      throw new OperationGuardError(`${spec.name}: a ${access} tool needs exactly one ${expected}; its document has ${info.operations} operation(s) and is a ${info.kind}.`);
    }
    const description = describe(spec.name, spec.description);
    const tool = defineTool({
      name: spec.name,
      description,
      inputSchema: spec.input,
      annotations,
      handler: async (args) => {
        const client = getClient();
        const variables = spec.variables?.(args);
        const context = spec.context?.(args);
        const callOptions = {
          ...(variables !== undefined ? { variables } : {}),
          ...(context?.store !== undefined ? { store: context.store } : {}),
          ...(context?.currency !== undefined ? { currency: context.currency } : {}),
        };
        const result = access === "read" ? await client.query(spec.document, callOptions) : await client.mutate(spec.document, callOptions);
        return shapeResult(result, spec.pick, spec.transform === undefined ? undefined : (value) => spec.transform?.(value, args));
      },
    });
    return { ...tool, access, document: spec.document } as unknown as MagentoGraphqlTool;
  }

  function describe(name: string, description: string): string {
    return liveVerified.has(name) ? description : `${description} ${UNVERIFIED_MARKER} — ${UNVERIFIED_DETAIL}`;
  }

  return {
    dynamicQueryTool: (spec) =>
      ({
        ...defineTool({
          name: spec.name,
          description: describe(spec.name, spec.description),
          inputSchema: spec.input,
          annotations: READ_ONLY_ANNOTATIONS,
          handler: async (args) => shapeResult(await spec.run(args, getClient()), undefined),
        }),
        access: "read",
      }) as unknown as MagentoGraphqlTool,
    readTool: (spec) => build(spec, READ_ONLY_ANNOTATIONS, "read"),
    writeTool: (spec) => build(spec, WRITE_ANNOTATIONS[spec.effect], "write"),
  };
}
