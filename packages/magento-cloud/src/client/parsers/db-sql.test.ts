// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2). `db:sql`'s columns are whatever the
// caller's own SELECT names — there is no fixed `REQUIRED_HEADERS` to
// declare, unlike every other parser in this directory. This is stated
// explicitly (design.md's own "CI cannot detect drift" honesty extends
// here too): the header row IS validated to exist and be non-empty, but
// its CONTENTS are never checked against a fixed list.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDbSqlRows } from "./db-sql.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseDbSqlRows", () => {
  it("maps rows keyed by whatever header the query's own column list produced", () => {
    expect(parseDbSqlRows(readFixture("db-sql-select.txt"))).toEqual([{ entity_id: "1", sku: "acme-demo-sku" }]);
  });

  it("returns an empty array for a header-only, zero-row result set", () => {
    expect(parseDbSqlRows("entity_id\tsku\n")).toEqual([]);
  });
});
