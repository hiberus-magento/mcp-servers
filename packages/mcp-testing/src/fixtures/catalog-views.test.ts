// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SYNTHETIC_SITES, SYNTHETIC_VERTICALS } from "./synthetic-identifiers.js";

const csvPath = fileURLToPath(new URL("./catalog-views.csv", import.meta.url));

function parseCsv(raw: string): Array<Record<string, string>> {
  const [header, ...rows] = raw.trim().split("\n");
  const columns = (header ?? "").split(",");
  return rows.map((row) => {
    const values = row.split(",");
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
  });
}

describe("catalog-views.csv", () => {
  it("uses only synthetic vertical and site values declared in synthetic-identifiers.ts", () => {
    const rows = parseCsv(readFileSync(csvPath, "utf8"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(SYNTHETIC_VERTICALS as readonly string[]).toContain(row.vertical);
      expect(SYNTHETIC_SITES as readonly string[]).toContain(row.site);
    }
  });

  it("contains no obviously real customer identifier substrings", () => {
    const raw = readFileSync(csvPath, "utf8");
    // A loose but real check: none of the values resemble a real production
    // domain/org (this repository is public — every identifier must be
    // synthetic, per synthetic-identifiers.ts).
    expect(raw).not.toMatch(/hiberus\.com|\.magento\.|production|customer-\d+/i);
  });

  // The three assertions below prove the `aco-package` migration
  // (design.md, Decision 5) is additive: the header gains the ACO hand-off
  // columns without renaming, reordering ahead of their original position,
  // or dropping any of the four original columns. The two `it()` blocks
  // above are untouched by this migration — that is the additive guarantee
  // in practice, not just in the header assertion below.
  it("declares the exact header order, including the additive ACO hand-off columns", () => {
    const raw = readFileSync(csvPath, "utf8");
    const [header] = raw.trim().split("\n");
    const columns = (header ?? "").split(",");
    expect(columns).toEqual(["vertical", "site", "locale", "view_code", "ac_view_id", "ac_price_book_id", "currency"]);
  });

  it("keeps the first four columns in their original name and position (additive-migration guard)", () => {
    const raw = readFileSync(csvPath, "utf8");
    const [header] = raw.trim().split("\n");
    const columns = (header ?? "").split(",");
    expect(columns.slice(0, 4)).toEqual(["vertical", "site", "locale", "view_code"]);
  });

  it("uses only synthetic ACO currency and id-prefix values declared in synthetic-identifiers.ts", async () => {
    const { SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX, SYNTHETIC_AC_VIEW_ID_PREFIX, SYNTHETIC_CURRENCIES } = await import("./synthetic-identifiers.js");
    const rows = parseCsv(readFileSync(csvPath, "utf8"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(SYNTHETIC_CURRENCIES as readonly string[]).toContain(row.currency);
      expect(row.ac_view_id?.startsWith(SYNTHETIC_AC_VIEW_ID_PREFIX)).toBe(true);
      expect(row.ac_price_book_id?.startsWith(SYNTHETIC_AC_PRICE_BOOK_ID_PREFIX)).toBe(true);
    }
  });
});
