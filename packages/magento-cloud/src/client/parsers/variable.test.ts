// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseVariableGet, parseVariableList } from "./variable.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseVariableList", () => {
  it("maps every variable:list row, including a sensitive value left blank by the CLI itself", () => {
    expect(parseVariableList(readFixture("variable-list.txt"))).toEqual([
      { name: "DEMO_FEATURE_FLAG", value: "on", is_sensitive: "false" },
      { name: "DEMO_SECRET_VAR", value: "", is_sensitive: "true" },
    ]);
  });
});

describe("parseVariableGet", () => {
  it("maps variable:get's field/value rows", () => {
    expect(parseVariableGet(readFixture("variable-get.txt"))).toEqual({ name: "DEMO_FEATURE_FLAG", value: "on" });
  });
});
