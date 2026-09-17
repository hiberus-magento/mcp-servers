// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (aco-package design.md, "Cross-domain proof"): a read-only,
// pure parser for the shared `catalog-views.csv` fixture shape, resolving
// the catalog-view hand-off row `aco-package`'s `provision` pipeline
// produces for a given `(vertical, site)` pair. Column-name-keyed, exactly
// like `packages/mcp-testing/src/fixtures/catalog-views.test.ts`'s own
// parser, so appended columns stay inert here too — this is the genuine
// "EDS-side config path" `packages/aco/src/cross-domain.test.ts` reads
// through, proving the fixture is shared state rather than two compatible
// copies.
import { describe, expect, it } from "vitest";
import { resolveCatalogViewConfig } from "./catalog-views.js";

const CSV_TEXT = ["vertical,site,locale,view_code,ac_view_id,ac_price_book_id,currency", "outdoor-gear,acme-demo-site-eu,en_US,outdoor_gear_eu_en,acv-demo-outdoor-gear-eu,acpb-demo-eur,EUR"].join(
  "\n",
);

describe("resolveCatalogViewConfig", () => {
  it("resolves the row for the exact (vertical, site) pair, keyed by column name", () => {
    const result = resolveCatalogViewConfig(CSV_TEXT, "outdoor-gear", "acme-demo-site-eu");

    expect(result).toEqual({
      vertical: "outdoor-gear",
      site: "acme-demo-site-eu",
      locale: "en_US",
      viewCode: "outdoor_gear_eu_en",
      acViewId: "acv-demo-outdoor-gear-eu",
      acPriceBookId: "acpb-demo-eur",
      currency: "EUR",
    });
  });

  it("returns undefined for a (vertical, site) pair not present in the CSV", () => {
    const result = resolveCatalogViewConfig(CSV_TEXT, "home-decor", "acme-demo-site-us");

    expect(result).toBeUndefined();
  });

  it("stays inert to an appended column it does not recognize (additive-migration guard)", () => {
    const withExtraColumn = [
      "vertical,site,locale,view_code,ac_view_id,ac_price_book_id,currency,future_column",
      "outdoor-gear,acme-demo-site-eu,en_US,outdoor_gear_eu_en,acv-demo-outdoor-gear-eu,acpb-demo-eur,EUR,unrecognized-value",
    ].join("\n");

    const result = resolveCatalogViewConfig(withExtraColumn, "outdoor-gear", "acme-demo-site-eu");

    expect(result?.acViewId).toBe("acv-demo-outdoor-gear-eu");
  });
});
