// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
//
// The strongest proof here (the leak test) runs on the SERIALIZED result,
// not the in-memory object — a variable's value cannot reach an agent even
// through `JSON.stringify`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseVariableGet, parseVariableList } from "./variable.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

// The fixture's sensitive cell, kept in one place so the leak test and the
// positive control cannot drift apart.
const FIXTURE_SECRET_FRAGMENT = "demo-pass";

describe("parseVariableList", () => {
  // CHANGED DELIBERATELY: this test used to assert a `value` field and a
  // comment claimed the CLI blanks a sensitive variable's value cell. A live
  // smoke test disproved that — `variable:list` printed a project variable
  // holding http-basic credentials in full. There is no `is_sensitive`
  // column on `variable:list` to filter on either, so the value is dropped by
  // construction instead, exactly as `parseServiceEndpoints` drops
  // credentials (design.md, Decision 7).
  it("maps every variable:list row to name, level, and enabled — never the value", () => {
    expect(parseVariableList(readFixture("variable-list.txt"))).toEqual([
      { name: "DEMO_FEATURE_FLAG", level: "environment", enabled: "true", hasValue: true },
      { name: "DEMO_COMPOSER_AUTH", level: "project", enabled: "true", hasValue: true },
    ]);
  });

  it("reports hasValue false when the CLI prints an empty value cell", () => {
    const text = "Name\tLevel\tValue\tEnabled\nDEMO_UNSET\tenvironment\t\ttrue\n";

    expect(parseVariableList(text)).toEqual([
      { name: "DEMO_UNSET", level: "environment", enabled: "true", hasValue: false },
    ]);
  });

  it("cannot leak a value even through JSON.stringify", () => {
    const serialized = JSON.stringify(parseVariableList(readFixture("variable-list.txt")));

    expect(serialized).not.toContain(FIXTURE_SECRET_FRAGMENT);
    expect(serialized).not.toContain("http-basic");
    expect(serialized).not.toContain("password");
  });

  // POSITIVE CONTROL: the leak test above proves nothing unless the same
  // probe detects the leak it claims to catch. The raw fixture text does
  // carry the secret, so a probe that cannot see it there is broken.
  it("positive control: the same probe detects the secret in the raw CLI output", () => {
    const raw = readFixture("variable-list.txt");

    expect(raw).toContain(FIXTURE_SECRET_FRAGMENT);
    expect(raw).toContain("http-basic");
  });

  // POSITIVE CONTROL: header enforcement must still fire.
  it("positive control: still throws when a required header is absent", () => {
    expect(() => parseVariableList("Name\tLevel\tEnabled\nDEMO\tproject\ttrue\n")).toThrow(/value/);
  });
});

describe("parseVariableGet", () => {
  it("maps variable:get's field/value rows", () => {
    expect(parseVariableGet(readFixture("variable-get.txt"))).toEqual({ name: "DEMO_FEATURE_FLAG", value: "on" });
  });
});
