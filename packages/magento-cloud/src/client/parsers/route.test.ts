// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MagentoCloudOutputShapeError } from "../errors.js";
import { parseRouteList, ROUTE_LIST_REQUIRED_HEADERS } from "./route.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseRouteList", () => {
  // CHANGED DELIBERATELY: `route:list` is now invoked with an explicit
  // `--columns route,type,to,url` set (`../commands.ts`), so the real header
  // row gained `URL`.
  it("maps route:list rows keyed by header, including the redirect row", () => {
    expect(parseRouteList(readFixture("route-list.txt"))).toEqual([
      {
        route: "https://acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
        type: "upstream",
        to: "demo-app:http",
        url: "https://acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
      },
      {
        route: "http://acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
        type: "redirect",
        to: "https://acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
        url: "http://acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
      },
    ]);
  });

  it("declares its own REQUIRED_HEADERS", () => {
    expect(ROUTE_LIST_REQUIRED_HEADERS).toEqual(["route", "type", "to", "url"]);
  });

  it("POSITIVE CONTROL: output missing a required header still throws", () => {
    expect(() => parseRouteList("Route\tType\tTo\nhttps://demo/\tupstream\tdemo-app:http\n")).toThrow(
      MagentoCloudOutputShapeError,
    );
  });
});

// The extra column is appended HERE rather than written into the fixture, so
// the fixture keeps matching the header row the CLI really prints.
const ROUTE_LIST_UNDECLARED_MARKER = "DEMOROUTEPRIMARY";
const routeListWithUndeclaredColumn = () =>
  "Route\tType\tTo\tURL\tPrimary\n" +
  "https://acme-demo-env-main-acme-demo-project.demo-region.example-domain/\tupstream\tdemo-app:http\t" +
  `https://acme-demo-env-main-acme-demo-project.demo-region.example-domain/\t${ROUTE_LIST_UNDECLARED_MARKER}\n`;

describe("parseRouteList — undeclared columns", () => {
  // The strongest proof here runs on the SERIALIZED result, not the in-memory
  // object: a narrow return type is a compile-time claim only, and
  // `rowsToRecords` keys a record by EVERY header the CLI printed.
  it("cannot leak an undeclared column even through JSON.stringify", () => {
    const serialized = JSON.stringify(parseRouteList(routeListWithUndeclaredColumn()));

    expect(serialized).not.toMatch(/primary/i);
    expect(serialized).not.toContain(ROUTE_LIST_UNDECLARED_MARKER);
  });

  // POSITIVE CONTROL: the same probe must find the marker in the raw text.
  it("positive control: the same probe finds the undeclared column in the raw CLI output", () => {
    const raw = routeListWithUndeclaredColumn();

    expect(raw).toMatch(/primary/i);
    expect(raw).toContain(ROUTE_LIST_UNDECLARED_MARKER);
  });
});
