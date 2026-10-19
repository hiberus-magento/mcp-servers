// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.7): `SearchCatalog` wraps `productSearch`, the
// Merchandising track's single highest-value capability (design.md,
// Decision 3). No credential required for an unprotected view. The response
// fixture (tasks.md 2.20) lives in `packages/aco/fixtures/search.json`,
// synthetic values only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlOk } from "../../testing/fetch-double.js";
import { selectionOf } from "../../testing/operation-documents.js";
import { createMerchandisingTransport } from "../http.js";
import { searchCatalog } from "./search.js";

const SEARCH_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/search.json", import.meta.url)), "utf8")) as {
  readonly productSearch: { readonly total_count: number; readonly items: readonly { readonly productView: { readonly attributes: readonly { readonly name: string; readonly value: string }[] } }[]; readonly facets: readonly unknown[] };
};

const NOOP_SLEEP = async (): Promise<void> => undefined;
const FIXED_NOW = (): number => 0;

describe("searchCatalog", () => {
  it("issues the named SearchCatalog query against the merchandising track with no credential", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /graphql SearchCatalog": graphQlOk(SEARCH_FIXTURE),
    });
    const transport = createMerchandisingTransport({
      fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://merch.aco.example/graphql",
    });

    const result = await searchCatalog(transport, { viewId: "acv-demo-outdoor-gear-eu", locale: "en_US", phrase: "tent" });

    const expectedAttribute = SEARCH_FIXTURE.productSearch.items[0]?.productView.attributes[0] as { readonly name: string; readonly value: string };
    expect(result.totalCount).toBe(SEARCH_FIXTURE.productSearch.total_count);
    expect(result.items[0]?.attributes[expectedAttribute.name]).toBe(expectedAttribute.value);
    expect(calls[0]?.operationName).toBe("SearchCatalog");
    expect(calls[0]?.headers["ac-view-id"]).toBe("acv-demo-outdoor-gear-eu");
    expect(calls[0]?.headers["authorization"]).toBeUndefined();
  });

  /**
   * `productSearch(phrase:)` is `String!`. The document declared
   * `$phrase: String`, which no conformant server accepts in that position
   * — the live service answered `Variable "$phrase" of type "String" used
   * in position expecting type "String!"` and ran nothing. The assertion
   * above never saw it, because the fetch double routes on the operation
   * NAME and never reads the declaration.
   */
  it("declares $phrase as the non-null String! the field requires, and always sends it", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /graphql SearchCatalog": graphQlOk(SEARCH_FIXTURE),
    });
    const transport = createMerchandisingTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://merch.aco.example/graphql" });

    await searchCatalog(transport, { viewId: "acv-demo-outdoor-gear-eu", locale: "en_US", phrase: "tent" });

    const posted = JSON.parse(calls[0]?.body ?? "{}") as { readonly query?: string; readonly variables?: Readonly<Record<string, unknown>> };
    expect(posted.query ?? "").toContain("$phrase: String!");
    expect(posted.variables?.["phrase"]).toBe("tent");
  });

  /**
   * `Aggregation.buckets` is of INTERFACE type `Bucket`, whose only common
   * field is `title`. This document selected `value` and `count`: `value`
   * exists on no implementation at all, and `count` is reachable only
   * through an inline fragment. With every selected subfield invalid, the
   * service answers `Field "buckets" of type "Aggregation" must have a
   * selection of subfields` — so this query, too, ran nowhere. The fetch
   * double routes on the operation NAME and never reads the selection,
   * which is why the assertion above passed throughout.
   */
  it("selects the Bucket interface's own `title` plus the count-bearing inline fragments, and never `value`", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /graphql SearchCatalog": graphQlOk(SEARCH_FIXTURE),
    });
    const transport = createMerchandisingTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://merch.aco.example/graphql" });

    await searchCatalog(transport, { viewId: "acv-demo-outdoor-gear-eu", locale: "en_US", phrase: "tent" });

    const document = (JSON.parse(calls[0]?.body ?? "{}") as { readonly query?: string }).query ?? "";
    const { fields, fragmentFields } = selectionOf(document, "buckets");
    expect(fields).toEqual(["title"]);
    expect(fields).not.toContain("value");
    // Pinned exactly: a schema-free parser cannot tell that `ScalarBucket`
    // is a real implementation of `Bucket` or that `StatsBucket` carries no
    // `count`, so the verified type names and their fields are asserted here.
    expect(fragmentFields).toEqual({
      ScalarBucket: ["count"],
      RangeBucket: ["count", "from", "to"],
      CategoryBucket: ["count"],
      StatsBucket: ["min", "max"],
    });
  });
});
