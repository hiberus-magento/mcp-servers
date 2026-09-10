// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 1.17): `ScrollPage<T>` is the shape that confines
// `scrollId` pagination to `priceBooks` (design.md, Decision 4). Phase 2's
// `ListPriceBooksResult` does not exist yet, so this proves the structural
// contract generically now — with a fixture shaped exactly like the real
// result will be, and a negative fixture shaped like every OTHER result
// type (no `items` field) — and Phase 2 will bind the real type against
// the same contract once it exists.
import { describe, expect, it } from "vitest";
import type { ScrollPage } from "./cursor.js";

interface FakePriceBooksResult {
  readonly items: readonly { readonly id: string }[];
  readonly scrollId?: string;
}

interface FakePoliciesResult {
  readonly policies: readonly { readonly policyId: string }[];
}

describe("ScrollPage<T>", () => {
  it("a result shaped like items+scrollId (the real ListPriceBooksResult shape) satisfies ScrollPage", () => {
    const fixture: FakePriceBooksResult = { items: [{ id: "acpb-demo-eur" }], scrollId: "cursor-1" };
    const page: ScrollPage<{ readonly id: string }> = fixture;

    expect(page.items).toHaveLength(1);
    expect(page.scrollId).toBe("cursor-1");
  });

  it("a result without scrollId still satisfies ScrollPage — the cursor field is optional", () => {
    const page: ScrollPage<{ readonly id: string }> = { items: [] };

    expect(page.items).toEqual([]);
    expect(page.scrollId).toBeUndefined();
  });

  it("a result without an items field fails the structural contract (proven under `pnpm typecheck`)", () => {
    const policiesResult: FakePoliciesResult = { policies: [{ policyId: "restricted-catalog" }] };
    // @ts-expect-error — FakePoliciesResult has no `items` field, so no
    // non-priceBooks result type can ever satisfy ScrollPage<T>: "paginate
    // the policies query" is a tsc error, not a runtime surprise.
    const page: ScrollPage<unknown> = policiesResult;
    expect(page).toBeDefined();
  });
});
