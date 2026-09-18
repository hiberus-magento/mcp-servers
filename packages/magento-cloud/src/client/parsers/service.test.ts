// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MagentoCloudOutputShapeError } from "../errors.js";
import { parseServiceList, SERVICE_LIST_REQUIRED_HEADERS } from "./service.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseServiceList", () => {
  // `Disk (MiB)` normalizes to `disk_mib`; a service with no disk of its own
  // (a cache) leaves that cell empty, which is data, not a missing column.
  it("maps every service:list row keyed by header, including the disk and size columns", () => {
    expect(parseServiceList(readFixture("service-list.txt"))).toEqual([
      { name: "database", type: "mysql:10.6", disk_mib: "2048", size: "M" },
      { name: "cache", type: "redis:7.0", disk_mib: "", size: "M" },
    ]);
  });

  it("declares its own REQUIRED_HEADERS", () => {
    expect(SERVICE_LIST_REQUIRED_HEADERS).toEqual(["name", "type", "disk_mib", "size"]);
  });

  it("POSITIVE CONTROL: output missing a required header still throws", () => {
    expect(() => parseServiceList("Name\tType\tSize\ndatabase\tmysql:10.6\tM\n")).toThrow(MagentoCloudOutputShapeError);
  });
});

// The extra column is appended HERE rather than written into the fixture, so
// the fixture keeps matching the header row the CLI really prints.
const SERVICE_LIST_UNDECLARED_MARKER = "DEMOSERVICEHOSTNAME";
const serviceListWithUndeclaredColumn = () =>
  "Name\tType\tDisk (MiB)\tSize\tHostname\n" + `database\tmysql:10.6\t2048\tM\t${SERVICE_LIST_UNDECLARED_MARKER}\n`;

describe("parseServiceList — undeclared columns", () => {
  // The strongest proof here runs on the SERIALIZED result, not the in-memory
  // object: a narrow return type is a compile-time claim only, and
  // `rowsToRecords` keys a record by EVERY header the CLI printed.
  it("cannot leak an undeclared column even through JSON.stringify", () => {
    const serialized = JSON.stringify(parseServiceList(serviceListWithUndeclaredColumn()));

    expect(serialized).not.toMatch(/hostname/i);
    expect(serialized).not.toContain(SERVICE_LIST_UNDECLARED_MARKER);
  });

  // POSITIVE CONTROL: the same probe must find the marker in the raw text.
  it("positive control: the same probe finds the undeclared column in the raw CLI output", () => {
    const raw = serviceListWithUndeclaredColumn();

    expect(raw).toMatch(/hostname/i);
    expect(raw).toContain(SERVICE_LIST_UNDECLARED_MARKER);
  });
});
