// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2). `db:sql`'s own row parsing is intentionally
// NOT here — its headers are whatever columns the caller's SELECT names,
// so it has no fixed `REQUIRED_HEADERS` to declare (see `db-sql.ts`'s own
// header comment for that exception, stated explicitly rather than
// silently applying a fixed schema to an arbitrary query).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDbSize } from "./db.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseDbSize", () => {
  // The real columns are `Allocated disk`, `Estimated usage` and `% used` —
  // two byte counts and an integer percentage, not the megabyte pair this
  // expectation used to name. Only stdout is parsed: the CLI's progress text
  // and its deprecation notice go to stderr.
  it("maps db:size's single-row table into one record", () => {
    expect(parseDbSize(readFixture("db-size.txt"))).toEqual({
      allocated_disk: "2147483648",
      estimated_usage: "1073741824",
      percent_used: "50",
    });
  });
});
