// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Read-only, pure parser for the shared `catalog-views.csv` fixture shape
// (aco-package design.md, "Cross-domain proof"). Resolves the catalog-view
// hand-off row `aco-package`'s `provision` pipeline is expected to produce,
// for a given `(vertical, site)` pair. Column-name-keyed, exactly like
// `packages/mcp-testing/src/fixtures/catalog-views.test.ts`'s own parser,
// so an appended column stays inert here too — this is the genuine
// "EDS-side config path" the cross-domain proof reads through.
export interface CatalogViewConfigRow {
  readonly vertical: string;
  readonly site: string;
  readonly locale: string;
  readonly viewCode: string;
  readonly acViewId?: string;
  readonly acPriceBookId?: string;
  readonly currency?: string;
}

function parseCsvRows(raw: string): readonly Record<string, string>[] {
  const [header, ...rows] = raw.trim().split("\n");
  const columns = (header ?? "").split(",");
  return rows
    .filter((row) => row.length > 0)
    .map((row) => {
      const values = row.split(",");
      return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
    });
}

/** Returns `undefined` when no row matches `(vertical, site)` — never throws on a missing hand-off row. */
export function resolveCatalogViewConfig(csvText: string, vertical: string, site: string): CatalogViewConfigRow | undefined {
  const row = parseCsvRows(csvText).find((entry) => entry["vertical"] === vertical && entry["site"] === site);
  if (row === undefined) {
    return undefined;
  }
  const acViewId = row["ac_view_id"];
  const acPriceBookId = row["ac_price_book_id"];
  const currency = row["currency"];
  return {
    vertical: row["vertical"] ?? "",
    site: row["site"] ?? "",
    locale: row["locale"] ?? "",
    viewCode: row["view_code"] ?? "",
    ...(acViewId !== undefined && acViewId.length > 0 ? { acViewId } : {}),
    ...(acPriceBookId !== undefined && acPriceBookId.length > 0 ? { acPriceBookId } : {}),
    ...(currency !== undefined && currency.length > 0 ? { currency } : {}),
  };
}
