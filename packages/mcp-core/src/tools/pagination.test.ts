// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { paginate, paginationSchema } from "./pagination.js";

describe("paginationSchema", () => {
  it("defaults page to 1 and pageSize to 50 when omitted", () => {
    const parsed = paginationSchema.parse({});
    expect(parsed).toEqual({ page: 1, pageSize: 50 });
  });

  it("rejects a pageSize above 200", () => {
    const result = paginationSchema.safeParse({ page: 1, pageSize: 201 });
    expect(result.success).toBe(false);
  });

  it("composes into a tool's own input schema via spread", () => {
    const toolSchema = z.object({ query: z.string(), ...paginationSchema.shape });
    const parsed = toolSchema.parse({ query: "catalog", page: 2 });
    expect(parsed).toEqual({ query: "catalog", page: 2, pageSize: 50 });
  });
});

describe("paginate", () => {
  it("returns only the requested page's items, not the whole collection", () => {
    const items = Array.from({ length: 25 }, (_, index) => index);

    const result = paginate(items, { page: 2, pageSize: 10 });

    expect(result.items).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(result.items).toHaveLength(10);
  });

  it("reports nextPage when more items remain, and null on the last page", () => {
    const items = Array.from({ length: 25 }, (_, index) => index);

    const firstPage = paginate(items, { page: 1, pageSize: 10 });
    const lastPage = paginate(items, { page: 3, pageSize: 10 });

    expect(firstPage.nextPage).toBe(2);
    expect(lastPage.items).toEqual([20, 21, 22, 23, 24]);
    expect(lastPage.nextPage).toBeNull();
  });
});
