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
});
