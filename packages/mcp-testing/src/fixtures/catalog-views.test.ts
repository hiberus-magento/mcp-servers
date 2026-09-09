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
});
