// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2). `app:config-get`'s fixture
// (`app-config-get.txt`) is `key: value` YAML-shaped, NOT tab-delimited —
// this is why it gets its own small parser instead of reusing `../tsv.ts`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAppConfig } from "./app-config.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseAppConfig", () => {
  it("maps colon-separated key: value lines into a plain record", () => {
    expect(parseAppConfig(readFixture("app-config-get.txt"))).toEqual({
      name: "demo-app",
      type: "php:8.3",
      disk: "2048",
    });
  });

  it("a naive tab-split would produce no columns at all — proving this fixture is NOT tab-delimited", () => {
    const text = readFixture("app-config-get.txt");
    const firstLine = text.split("\n")[0]!;

    expect(firstLine.split("\t")).toHaveLength(1);
  });
});
