// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRouteList } from "./route.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseRouteList", () => {
  // The real header row is `Route`, `Type`, `To` — there is no `upstream`
  // column, which is what this expectation used to name.
  it("maps route:list rows keyed by header, including the redirect row", () => {
    expect(parseRouteList(readFixture("route-list.txt"))).toEqual([
      {
        route: "https://acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
        type: "upstream",
        to: "demo-app:http",
      },
      {
        route: "http://acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
        type: "redirect",
        to: "https://acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
      },
    ]);
  });
});
