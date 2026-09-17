// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseServiceList } from "./service.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseServiceList", () => {
  it("maps every service:list row keyed by header", () => {
    expect(parseServiceList(readFixture("service-list.txt"))).toEqual([
      { name: "database", type: "mysql:10.6" },
      { name: "cache", type: "redis:7.0" },
    ]);
  });
});
