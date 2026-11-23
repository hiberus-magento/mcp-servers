// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// defineTool() with compile-time-enforced annotations (design.md, Decision
// 3). Omitting any of readOnlyHint/destructiveHint/idempotentHint, writing a
// contradictory combination (readOnlyHint: true with destructiveHint: true),
// or supplying an empty description is a `tsc` error, not a review finding
// or a runtime assertion. Proven by `define-tool.test-d.ts` under
// `vitest --typecheck`.
//
// Deviation from design.md's literal snippet: the design was written against
// zod v3's `z.ZodObject<z.ZodRawShape>` generic shape. This repo pins zod
// v4.5.4, whose `ZodObject` has a differently-named internal shape type
// (`$ZodShape`, not exported as `ZodRawShape`) and ships default generic
// parameters instead. `TIn extends z.ZodObject` (no explicit shape argument)
// is the v4-idiomatic equivalent constraint.
import type { z } from "zod";
import { CredentialExpiredError, MissingCredentialError } from "../credentials/token-provider.js";
import { truncate } from "../truncate/truncate.js";

export type NonEmpty<S extends string> = S extends "" ? never : S;

// read-only implies non-destructive and idempotent — but all three are
// still written explicitly at every call site.
export type ToolAnnotations =
  | {
      readonly readOnlyHint: true;
      readonly destructiveHint: false;
      readonly idempotentHint: true;
      readonly title?: string;
      readonly openWorldHint?: boolean;
    }
  | {
      readonly readOnlyHint: false;
      readonly destructiveHint: boolean;
      readonly idempotentHint: boolean;
      readonly title?: string;
      readonly openWorldHint?: boolean;
    };

export interface ToolContext {
  readonly signal?: AbortSignal;
  /**
   * Present only when the client asked for progress (a `progressToken` in the
   * request). A long tool calls it so the client does not give up on a call
   * that is still working; `progress` must grow from one call to the next.
   */
  readonly reportProgress?: (progress: number, total: number | undefined, message: string) => Promise<void>;
}

export interface ToolCallContent {
  readonly type: "text";
  readonly text: string;
}

export interface ToolCallResult {
  readonly content: readonly ToolCallContent[];
  /** Present when the tool declares an `outputSchema`: the result itself, which `content` mirrors as text. */
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
  /**
   * Why `invoke` itself answered with an error, so a server can type it for its host: `credential` when no usable
   * credential was found, `too_large` when a structured result was over the output cap. Absent otherwise.
   */
  readonly errorKind?: "credential" | "too_large";
}

export interface ToolDefinition<TIn extends z.ZodObject, TOut, D extends string> {
  readonly name: string;
  readonly description: NonEmpty<D>;
  readonly inputSchema: TIn;
  /**
   * The shape of a successful result. When present, the handler's result is returned as `structuredContent` (an MCP
   * client validates it against this schema) and mirrored exactly as JSON text in `content`, so the handler must return
   * an object. A result whose JSON is over the output cap is refused with an error rather than truncated.
   */
  readonly outputSchema?: z.ZodObject;
  readonly annotations: ToolAnnotations;
  readonly handler: (args: z.infer<TIn>, ctx: ToolContext) => Promise<TOut>;
}

export interface RegisteredTool<TIn extends z.ZodObject, TOut> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: TIn;
  readonly outputSchema?: z.ZodObject;
  readonly annotations: ToolAnnotations;
  readonly handler: (args: z.infer<TIn>, ctx: ToolContext) => Promise<TOut>;
  invoke(rawArgs: unknown, ctx: ToolContext): Promise<ToolCallResult>;
}

// Backstop cap (design.md, Decision 6): applied to every tool's output
// regardless of whether its author remembered pagination. A tool that needs
// to return more than this should paginate instead of relying on a larger
// cap — see `../tools/pagination.ts`.
const DEFAULT_MAX_OUTPUT_BYTES = 100_000;

function toTextContent(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function defineTool<TIn extends z.ZodObject, TOut, const D extends string>(
  def: ToolDefinition<TIn, TOut, D>,
): RegisteredTool<TIn, TOut> {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    ...(def.outputSchema !== undefined ? { outputSchema: def.outputSchema } : {}),
    annotations: def.annotations,
    handler: def.handler,
    async invoke(rawArgs, ctx) {
      const parsed = def.inputSchema.parse(rawArgs) as z.infer<TIn>;
      let result: TOut;
      try {
        result = await def.handler(parsed, ctx);
      } catch (error) {
        if (error instanceof MissingCredentialError || error instanceof CredentialExpiredError) {
          // An immediate, actionable failure — never a hang waiting for
          // input an MCP server has no TTY to provide (design.md,
          // Decision 5).
          return { content: [{ type: "text", text: error.message }], isError: true, errorKind: "credential" };
        }
        throw error;
      }
      if (def.outputSchema !== undefined) {
        // The text must mirror the structured result exactly, so it is never truncated; a result over the cap is
        // refused instead of being sent whole next to a cut-off mirror.
        const json = JSON.stringify(result);
        const bytes = Buffer.byteLength(json, "utf8");
        if (bytes > DEFAULT_MAX_OUTPUT_BYTES) {
          return {
            content: [{ type: "text", text: `The result is ${bytes} bytes, over the ${DEFAULT_MAX_OUTPUT_BYTES}-byte limit; ask for fewer records.` }],
            isError: true,
            errorKind: "too_large",
          };
        }
        return { content: [{ type: "text", text: json }], structuredContent: result as Record<string, unknown> };
      }
      const text = truncate(toTextContent(result), DEFAULT_MAX_OUTPUT_BYTES);
      return { content: [{ type: "text", text }] };
    },
  };
}
