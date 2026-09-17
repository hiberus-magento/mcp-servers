// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.6): `ListPriceBooks` is a named admin query
// (exploration.md, `Q_PBOOKS`) — the only cursor-paginated query.
// `scrollId` round-trips across two pages; no third request is issued. The
// two-page response fixture (tasks.md 2.20) lives in
// `packages/aco/fixtures/price-books.json`, synthetic values only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlOk } from "../../testing/fetch-double.js";
import { createAdminTransport } from "../http.js";
import { listPriceBooks } from "./price-books.js";

const PRICE_BOOKS_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/price-books.json", import.meta.url)), "utf8")) as {
  readonly page1: { readonly priceBooks: { readonly items: readonly { readonly id: string; readonly name?: string; readonly currency?: string; readonly level?: string; readonly parentIds?: readonly string[] }[]; readonly scrollId?: string } };
  readonly page2: { readonly priceBooks: { readonly items: readonly { readonly id: string }[] } };
};

const NOOP_SLEEP = async (): Promise<void> => undefined;
const FIXED_NOW = (): number => 0;

function stubTokenProvider() {
  return {
    domain: "aco",
    getToken: async () => ({ kind: "static" as const, value: "test-only-bearer" }),
    invalidate: () => undefined,
    describeRemedy: () => ({ domain: "aco", cliCommand: "hiberus-aco auth token set", envVar: "ACO_TOKEN", configPath: "/dev/null", reason: "not found" }),
  };
}

describe("listPriceBooks", () => {
  it("issues the named ListPriceBooks query and returns id-keyed items with a scrollId", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /admin/graphql ListPriceBooks": graphQlOk(PRICE_BOOKS_FIXTURE.page1),
    });
    const transport = createAdminTransport({
      fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/admin/graphql",
      tokenProvider: stubTokenProvider(),
    });

    const result = await listPriceBooks(transport, {});

    expect(result.items).toEqual(PRICE_BOOKS_FIXTURE.page1.priceBooks.items);
    expect(result.scrollId).toBe(PRICE_BOOKS_FIXTURE.page1.priceBooks.scrollId);
    expect(calls[0]?.operationName).toBe("ListPriceBooks");
  });

  it("round-trips scrollId across two pages with no third request", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /admin/graphql ListPriceBooks": [graphQlOk(PRICE_BOOKS_FIXTURE.page1), graphQlOk(PRICE_BOOKS_FIXTURE.page2)],
    });
    const transport = createAdminTransport({
      fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/admin/graphql",
      tokenProvider: stubTokenProvider(),
    });

    const page1 = await listPriceBooks(transport, {});
    expect(page1.scrollId).toBe(PRICE_BOOKS_FIXTURE.page1.priceBooks.scrollId);

    const page2 = await listPriceBooks(transport, page1.scrollId !== undefined ? { scrollId: page1.scrollId } : {});
    expect(page2.scrollId).toBeUndefined();
    expect(page2.items).toEqual(PRICE_BOOKS_FIXTURE.page2.priceBooks.items);

    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]?.body ?? "{}").variables).toMatchObject({ scrollId: PRICE_BOOKS_FIXTURE.page1.priceBooks.scrollId });
  });
});
