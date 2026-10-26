// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The one factory every `magentorest_*` tool is built through, so these
// guarantees are written once instead of a hundred times:
//
//   - the input schema is whatever the caller passes, and `invoke` rejects an
//     unknown argument rather than ignoring it (every schema is `.strict()`);
//   - the output `shape` is REQUIRED: there is no overload that returns a
//     parsed response unprojected, so forgetting an allowlist is a `tsc`
//     error, not a data leak found in review;
//   - annotations come from the kind of effect, not from hand-typed booleans.
//     A tool's `readOnlyHint` is what makes an MCP client skip a confirmation
//     prompt, so it must never be a value someone can get wrong per tool;
//   - the client is resolved lazily, per call, so `tools/list` works before
//     the base URL is configured.
import { defineTool, type RegisteredTool, type ToolAnnotations } from "@hiberus-magento/mcp-core";
import type { z } from "zod";
import type { MagentoRestClient } from "../client/index.js";
import { project, type Shape } from "./project.js";
import { BASE_SHAPES, type ShapeSet } from "./shapes.js";
import { LIVE_VERIFIED_TOOLS, UNVERIFIED_DETAIL, UNVERIFIED_MARKER } from "./verification.js";

export type Access = "read" | "write";

/**
 * What a caller gets when Magento returned something but NONE of it is a field the tool reports.
 *
 * Stock Magento answers a create or update with the record. A store with extensions or customisation can answer with
 * something else (for example a queued-work acknowledgement such as `[{"success":true,"message":"..."}]`), which is not
 * a record. Projected through an allowlist it would become `[{}]`, which reads as a success that says nothing. A fixed notice is shown instead, and the replaced response is not echoed: an allowlist that drops a field
 * must not be undone by a message that quotes it.
 */
export const NOTHING_REPORTED_NOTICE =
  "Magento accepted the request, but its response contains none of the fields this tool reports, so nothing can be shown. " +
  "The store may handle this asynchronously or have customised it (for example by queueing the work): confirm with a read before relying on it.";

const isEmptyObject = (value: unknown): boolean => value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;

/** Raw has an object with at least one key, somewhere at the top level or as a list element. */
function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasContent);
  }
  return value !== null && typeof value === "object" && Object.keys(value).length > 0;
}

/** A projection that is `{}`, or a non-empty list made only of `{}`. */
function isEmptyShell(projected: unknown): boolean {
  return Array.isArray(projected) ? projected.length > 0 && projected.every(isEmptyObject) : isEmptyObject(projected);
}

/**
 * What a write does, which fixes its hints:
 * `create` adds a record (never destructive, not idempotent);
 * `update` overwrites one (destructive, idempotent);
 * `delete` removes one (destructive, idempotent);
 * `action` changes state with side effects — cancel, hold, invoice, refund,
 * ship (destructive, NOT idempotent: running it twice is not the same as once).
 */
export type WriteEffect = "create" | "update" | "delete" | "action";

export type MagentoRestTool = RegisteredTool<z.ZodObject, unknown> & { readonly access: Access };

type ToolName = `magentorest_${string}`;

interface ToolSpecBase<S extends z.ZodObject> {
  readonly name: ToolName;
  readonly description: string;
  readonly input: S;
  /** Allowlist for the result. Required — see the file header. */
  readonly shape: Shape;
  readonly run: (args: z.infer<S>, client: MagentoRestClient) => Promise<unknown>;
}

export type ReadToolSpec<S extends z.ZodObject> = ToolSpecBase<S>;

export interface WriteToolSpec<S extends z.ZodObject> extends ToolSpecBase<S> {
  readonly effect: WriteEffect;
}

export interface ToolFactory {
  /** The allowlists in effect for this server — the shipped ones, plus any the operator added. */
  readonly shapes: ShapeSet;
  readTool<S extends z.ZodObject>(spec: ReadToolSpec<S>): MagentoRestTool;
  writeTool<S extends z.ZodObject>(spec: WriteToolSpec<S>): MagentoRestTool;
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
  /** The allowlists tools project through; defaults to the shipped `BASE_SHAPES`. */
  readonly shapes?: ShapeSet;
}

export function createToolFactory(getClient: () => MagentoRestClient, options: ToolFactoryOptions = {}): ToolFactory {
  const liveVerified = options.liveVerified ?? LIVE_VERIFIED_TOOLS;
  const shapes = options.shapes ?? BASE_SHAPES;

  function build<S extends z.ZodObject>(spec: ToolSpecBase<S>, annotations: ToolAnnotations, access: Access): MagentoRestTool {
    // A tool not run against a real instance says so in the text an agent
    // reads when deciding whether to call it (see `verification.ts`).
    const description = liveVerified.has(spec.name) ? spec.description : `${spec.description} ${UNVERIFIED_MARKER} — ${UNVERIFIED_DETAIL}`;
    const tool = defineTool({
      name: spec.name,
      description,
      inputSchema: spec.input,
      annotations,
      handler: async (args) => {
        const raw = await spec.run(args, getClient());
        const projected = project(raw, spec.shape);
        if (hasContent(raw) && isEmptyShell(projected)) {
          return NOTHING_REPORTED_NOTICE;
        }
        // An empty body (a write that answers 200 with nothing) has no JSON form; `null` is its honest rendering.
        return projected === undefined ? null : projected;
      },
    });
    // The generic arguments differ per tool; the array type every module
    // returns is the widened one, so the cast is on the type only.
    return { ...tool, access } as unknown as MagentoRestTool;
  }

  return {
    shapes,
    readTool: (spec) => build(spec, READ_ONLY_ANNOTATIONS, "read"),
    writeTool: (spec) => build(spec, WRITE_ANNOTATIONS[spec.effect], "write"),
  };
}
