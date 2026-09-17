// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEnvironmentInfo, parseEnvironmentList, parseEnvironmentUrl } from "./environment.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseEnvironmentList", () => {
  it("maps every environment:list row keyed by header, including a second row", () => {
    const environments = parseEnvironmentList(readFixture("environment-list.txt"));

    expect(environments).toEqual([
      { id: "acme-demo-env-main", status: "active", type: "production", title: "Main" },
      { id: "acme-demo-env-stage", status: "active", type: "staging", title: "Staging" },
    ]);
  });
});

describe("parseEnvironmentInfo", () => {
  it("maps environment:info's field/value rows", () => {
    expect(parseEnvironmentInfo(readFixture("environment-info.txt"))).toEqual({
      id: "acme-demo-env-main",
      status: "active",
      type: "production",
    });
  });
});

describe("parseEnvironmentUrl", () => {
  it("maps the single-column environment:url table to its one value", () => {
    expect(parseEnvironmentUrl(readFixture("environment-url.txt"))).toBe(
      "https://acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
    );
  });
});
