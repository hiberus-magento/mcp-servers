// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.18): proves `catalog-views.csv` is genuinely SHARED
// state between `aco` and `eds`, not two packages independently parsing
// their own compatible copy (design.md, "Cross-domain proof"). One row is
// written with an `ac_view_id` via a pure ACO-side function, then read back
// through the REAL `eds`-side config reader
// (`@hiberus-magento/eds/config/catalog-views.js`) for the same
// `(vertical, site)` pair — a genuine cross-package round trip, requiring
// `@hiberus-magento/eds` as a `devDependency` of `aco` (task 2.19).
//
// Rejected alternative (design.md): reimplementing `eds`'s parse inside
// this test — that would prove a copy is compatible with a copy, which is
// the exact failure this test exists to rule out. `resolveCatalogViewConfig`
// below is imported from `eds`, not reimplemented.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveCatalogViewConfig } from "@hiberus-magento/eds/config/catalog-views.js";
import { SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX, SYNTHETIC_AC_VIEW_ID_PREFIX, SYNTHETIC_CURRENCIES, SYNTHETIC_LOCALES, SYNTHETIC_SITES, SYNTHETIC_VERTICALS } from "@hiberus-magento/mcp-testing";

const CATALOG_VIEWS_CSV_PATH = fileURLToPath(new URL("../../mcp-testing/src/fixtures/catalog-views.csv", import.meta.url));

const NEW_VERTICAL = SYNTHETIC_VERTICALS[2];
const NEW_SITE = SYNTHETIC_SITES[1];
const NEW_LOCALE = SYNTHETIC_LOCALES[1];
const NEW_VIEW_CODE = `${NEW_VERTICAL}_view`;
const NEW_AC_VIEW_ID = `${SYNTHETIC_AC_VIEW_ID_PREFIX}${NEW_VERTICAL}`;
const NEW_AC_PRICE_BOOK_ID = `${SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX}${SYNTHETIC_CURRENCIES[1].toLowerCase()}`;
const NEW_CURRENCY = SYNTHETIC_CURRENCIES[1];

/**
 * The ACO-side pure function this test proves against `eds`'s real reader.
 * Represents the hand-off `provision`'s catalog-view step (client/provision.ts)
 * is expected to record once it writes a view: append one CSV row, in
 * memory only — no file I/O, no side effects.
 */
function appendCatalogViewRow(
  csvText: string,
  row: { readonly vertical: string; readonly site: string; readonly locale: string; readonly viewCode: string; readonly acViewId: string; readonly acPriceBookId: string; readonly currency: string },
): string {
  const line = [row.vertical, row.site, row.locale, row.viewCode, row.acViewId, row.acPriceBookId, row.currency].join(",");
  return `${csvText.trimEnd()}\n${line}\n`;
}

describe("cross-domain: catalog-views.csv is shared state, not two parses", () => {
  it("a row written ACO-side with an ac_view_id is read back through the real eds-side config path", () => {
    // The real fixture's HEADER line only — every `(vertical, site)` data
    // combination is already taken in the committed fixture (three
    // verticals x two sites, fully enumerated), so starting from the real
    // header and zero data rows is what makes "never written before" true
    // for the assertion below, while still proving both functions agree on
    // the real fixture's exact column shape, not a hand-invented one.
    const [header] = readFileSync(CATALOG_VIEWS_CSV_PATH, "utf8").trim().split("\n");
    const baseCsvText = `${header}\n`;

    const updatedCsvText = appendCatalogViewRow(baseCsvText, {
      vertical: NEW_VERTICAL,
      site: NEW_SITE,
      locale: NEW_LOCALE,
      viewCode: NEW_VIEW_CODE,
      acViewId: NEW_AC_VIEW_ID,
      acPriceBookId: NEW_AC_PRICE_BOOK_ID,
      currency: NEW_CURRENCY,
    });

    const resolved = resolveCatalogViewConfig(updatedCsvText, NEW_VERTICAL, NEW_SITE);

    expect(resolved).toEqual({
      vertical: NEW_VERTICAL,
      site: NEW_SITE,
      locale: NEW_LOCALE,
      viewCode: NEW_VIEW_CODE,
      acViewId: NEW_AC_VIEW_ID,
      acPriceBookId: NEW_AC_PRICE_BOOK_ID,
      currency: NEW_CURRENCY,
    });
  });

  it("a (vertical, site) pair never written ACO-side resolves to undefined eds-side", () => {
    const [header] = readFileSync(CATALOG_VIEWS_CSV_PATH, "utf8").trim().split("\n");
    const baseCsvText = `${header}\n`;

    const resolved = resolveCatalogViewConfig(baseCsvText, NEW_VERTICAL, NEW_SITE);

    expect(resolved).toBeUndefined();
  });
});
