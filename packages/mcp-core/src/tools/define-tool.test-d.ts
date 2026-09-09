// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof for `defineTool()`'s compile-time annotation enforcement
// (design.md, Decision 3). A runtime test cannot assert "this does not
// compile" — `@ts-expect-error` inverts the assertion: if the line below it
// ever starts compiling, `tsc` fails with "Unused '@ts-expect-error'
// directive". Run under `vitest --typecheck` (see vitest.config.ts). Each
// case is wrapped in `test()` so vitest's typecheck collector recognizes
// this file as a valid suite; the bodies are never executed at runtime.
import { expectTypeOf, test } from "vitest";
import { z } from "zod";
import { defineTool } from "./define-tool.js";

const schema = z.object({ name: z.string() });

test("a complete tool definition compiles and infers correctly", () => {
  const complete = defineTool({
    name: "greet",
    description: "Greets a name.",
    inputSchema: schema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args) => `hello ${args.name}`,
  });
  expectTypeOf(complete.name).toEqualTypeOf<string>();
  expectTypeOf(complete.handler).returns.resolves.toEqualTypeOf<string>();
});

test("a non-read-only tool may declare any destructive/idempotent combination", () => {
  defineTool({
    name: "delete-thing",
    description: "Deletes a thing.",
    inputSchema: schema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler: async (args) => args.name,
  });
});

test("missing idempotentHint fails to compile", () => {
  defineTool({
    name: "broken-missing-hint",
    description: "Missing idempotentHint.",
    inputSchema: schema,
    // @ts-expect-error — missing idempotentHint fails to compile.
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: async (args: z.infer<typeof schema>) => args.name,
  });
});

test("readOnlyHint: true with destructiveHint: true fails to compile", () => {
  defineTool({
    name: "broken-contradiction",
    description: "Contradictory annotations.",
    inputSchema: schema,
    // @ts-expect-error — readOnlyHint: true with destructiveHint: true
    // matches no union member (read-only implies non-destructive).
    annotations: { readOnlyHint: true, destructiveHint: true, idempotentHint: true },
    handler: async (args: z.infer<typeof schema>) => args.name,
  });
});

test("an empty description fails to compile", () => {
  defineTool({
    name: "broken-empty-description",
    // @ts-expect-error — an empty description resolves NonEmpty<''> to never.
    description: "",
    inputSchema: schema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args: z.infer<typeof schema>) => args.name,
  });
});
