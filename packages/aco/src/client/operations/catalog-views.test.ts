// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.4): `ListCatalogViews` is a named admin query
// (exploration.md's `Q_VIEWS`, renamed upstream — see `catalog-views.ts`).
// The response fixture (tasks.md 2.20) lives in
// `packages/aco/fixtures/catalog-views.json`, synthetic values only, and
// mirrors a document that was executed against the live admin endpoint —
// the test reads the fixture rather than an inline literal so the recorded
// response shape, not a hand-written guess, is what the parser is fed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlOk } from "../../testing/fetch-double.js";
import { createAdminTransport } from "../http.js";
import { listCatalogViews } from "./catalog-views.js";

const CATALOG_VIEWS_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/catalog-views.json", import.meta.url)), "utf8")) as {
  readonly catalogViews: readonly {
    readonly viewId: string;
    readonly name: string;
    readonly defaultPriceBookId: string;
    readonly policyIds: readonly string[];
    readonly protectionEnabled: boolean;
    readonly allowedPriceBookIds: readonly string[];
    readonly restrictedAccessKeyIds: readonly string[];
    readonly sources: readonly { readonly locale: string }[];
    readonly layers: readonly { readonly order: number; readonly source: { readonly locale: string; readonly layer: string } }[];
  }[];
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

function buildTransport(route: Parameters<typeof createFetchDouble>[0]) {
  const { fetch, calls } = createFetchDouble(route);
  const transport = createAdminTransport({
    fetch,
    now: FIXED_NOW,
    sleep: NOOP_SLEEP,
    baseUrl: "https://admin.aco.example/admin/graphql",
    tokenProvider: stubTokenProvider(),
  });
  return { transport, calls };
}

describe("listCatalogViews", () => {
  it("issues the named ListCatalogViews query and flattens sources into locales", async () => {
    const { transport, calls } = buildTransport({ "POST /admin/graphql ListCatalogViews": graphQlOk(CATALOG_VIEWS_FIXTURE) });

    const result = await listCatalogViews(transport);

    const expected = CATALOG_VIEWS_FIXTURE.catalogViews[0] as (typeof CATALOG_VIEWS_FIXTURE.catalogViews)[number];
    expect(result.views).toEqual([
      {
        viewId: expected.viewId,
        name: expected.name,
        locales: expected.sources.map((source) => source.locale),
        defaultPriceBookId: expected.defaultPriceBookId,
        policyIds: expected.policyIds,
        protectionEnabled: expected.protectionEnabled,
        allowedPriceBookIds: expected.allowedPriceBookIds,
        restrictedAccessKeyIds: expected.restrictedAccessKeyIds,
        layers: expected.layers,
      },
    ]);
    expect(calls[0]?.operationName).toBe("ListCatalogViews");
  });

  /**
   * The upstream rename this operation exists to fix (`Query.channels` →
   * `Query.catalogViews`, `channelId` → `viewId`, `scopes` → `sources`) was
   * only observable as a server-side validation error, so the document text
   * itself is part of the contract: a document that re-grew the old field
   * names would still satisfy the assertion above, because the fetch double
   * routes on the operation NAME alone.
   */
  it("selects the renamed root field and its renamed subfields, and no retired name", async () => {
    const { transport, calls } = buildTransport({ "POST /admin/graphql ListCatalogViews": graphQlOk(CATALOG_VIEWS_FIXTURE) });

    await listCatalogViews(transport);

    const posted = JSON.parse(calls[0]?.body ?? "{}") as { readonly query?: string };
    const document = posted.query ?? "";
    expect(document).toContain("catalogViews");
    expect(document).toContain("viewId");
    expect(document).toContain("sources {");
    expect(document).toContain("source {");
    expect(document).not.toMatch(/\bchannels\b/);
    expect(document).not.toMatch(/\bchannelId\b/);
    expect(document).not.toMatch(/\bscopes?\b/);
  });
});
