// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.8): `FacetValues` is its own named query, issued
// exactly once, and never falls back to the Python CLI's page-sampling loop
// (design.md, Decision 3) — client-layer structural boundary #1. A
// non-facetable attribute (a fixture with no bucket data for it) returns a
// structured `{ facetable: false, reason }` instead of throwing or
// triggering additional requests: `fetchDouble.calls` MUST have length
// exactly 1.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlOk } from "../../testing/fetch-double.js";
import { createMerchandisingTransport } from "../http.js";
import { getFacetValues } from "./facets.js";

const NOOP_SLEEP = async (): Promise<void> => undefined;
const FIXED_NOW = (): number => 0;

const CONTEXT = { viewId: "acv-demo-outdoor-gear-eu", locale: "en_US" };

// The two response fixtures (tasks.md 2.20) live in
// `packages/aco/fixtures/facets.json`, synthetic values only.
const FACETS_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/facets.json", import.meta.url)), "utf8")) as {
  readonly facetable: { readonly productSearch: { readonly facets: readonly { readonly attribute: string; readonly buckets: readonly { readonly value: string; readonly count: number }[] }[] } };
  readonly nonFacetable: { readonly productSearch: { readonly facets: readonly { readonly attribute: string; readonly buckets: readonly unknown[] }[] } };
};

describe("getFacetValues", () => {
  it("returns facet values and issues exactly one request when the attribute is facetable", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /graphql FacetValues": graphQlOk(FACETS_FIXTURE.facetable),
    });
    const transport = createMerchandisingTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://merch.aco.example/graphql" });

    const result = await getFacetValues(transport, { ...CONTEXT, attribute: "color" });

    expect(result).toEqual({ facetable: true, values: FACETS_FIXTURE.facetable.productSearch.facets[0]?.buckets });
    expect(calls).toHaveLength(1);
  });

  it("returns a structured non-facetable result — never a fallback — and issues exactly one request", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /graphql FacetValues": graphQlOk(FACETS_FIXTURE.nonFacetable),
    });
    const transport = createMerchandisingTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://merch.aco.example/graphql" });

    const result = await getFacetValues(transport, { ...CONTEXT, attribute: "size" });

    expect(result.facetable).toBe(false);
    if (!result.facetable) {
      expect(result.reason).toContain("size");
    }
    expect(calls).toHaveLength(1);
  });
});
