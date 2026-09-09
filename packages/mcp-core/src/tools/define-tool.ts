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
}

export interface ToolCallContent {
  readonly type: "text";
  readonly text: string;
}

export interface ToolCallResult {
  readonly content: readonly ToolCallContent[];
  readonly isError?: boolean;
}

export interface ToolDefinition<TIn extends z.ZodObject, TOut, D extends string> {
  readonly name: string;
  readonly description: NonEmpty<D>;
  readonly inputSchema: TIn;
  readonly annotations: ToolAnnotations;
  readonly handler: (args: z.infer<TIn>, ctx: ToolContext) => Promise<TOut>;
}

export interface RegisteredTool<TIn extends z.ZodObject, TOut> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: TIn;
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
          return { content: [{ type: "text", text: error.message }], isError: true };
        }
        throw error;
      }
      const text = truncate(toTextContent(result), DEFAULT_MAX_OUTPUT_BYTES);
      return { content: [{ type: "text", text }] };
    },
  };
}
