// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Runtime behavior of `defineTool()`'s `invoke()` wrapper. Type-level
// enforcement of the tool definition shape is proven separately, under
// `vitest --typecheck`, in `define-tool.test-d.ts`.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "./define-tool.js";
import { paginate, paginationSchema } from "./pagination.js";

describe("defineTool().invoke", () => {
  it("parses input against the schema and returns the handler result as text content", async () => {
    const tool = defineTool({
      name: "greet",
      description: "Greets a name.",
      inputSchema: z.object({ name: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async (args) => `hello ${args.name}`,
    });

    const result = await tool.invoke({ name: "Ada" }, {});

    expect(result.content).toEqual([{ type: "text", text: "hello Ada" }]);
    expect(result.isError).toBeUndefined();
  });

  it("truncates oversized handler output as a backstop, even without pagination", async () => {
    const tool = defineTool({
      name: "dump-everything",
      description: "Returns far more text than any tool should return unbounded.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async () => "x".repeat(1_000_000),
    });

    const result = await tool.invoke({}, {});
    const text = result.content[0]?.text ?? "";

    expect(text.length).toBeLessThan(1_000_000);
    expect(text).toContain("[truncated:");
  });

  it("a paginated tool returns only the requested page's items, not the whole collection", async () => {
    const catalog = Array.from({ length: 25 }, (_, index) => `item-${index}`);
    const tool = defineTool({
      name: "list-catalog",
      description: "Lists catalog items, paginated.",
      inputSchema: z.object({ ...paginationSchema.shape }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async (args) => paginate(catalog, args),
    });

    const result = await tool.invoke({ page: 2, pageSize: 10 }, {});
    const parsed = JSON.parse(result.content[0]?.text ?? "{}") as { items: string[]; nextPage: number | null };

    expect(parsed.items).toEqual(catalog.slice(10, 20));
    expect(parsed.items).toHaveLength(10);
    expect(parsed.nextPage).toBe(3);
  });
});
