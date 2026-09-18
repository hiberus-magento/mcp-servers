// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MagentoCloudOutputShapeError } from "../errors.js";
import {
  ENVIRONMENT_LIST_REQUIRED_HEADERS,
  parseEnvironmentInfo,
  parseEnvironmentList,
  parseEnvironmentUrl,
  parseEnvironmentUrls,
} from "./environment.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseEnvironmentList", () => {
  // CHANGED DELIBERATELY: `environment:list` is now invoked with an explicit
  // `--columns id,title,status,type,created,machine_name,updated` set
  // (`../commands.ts`), so the real header row gained `Created`,
  // `Machine name` and `Updated`.
  it("maps every environment:list row keyed by header, including a second row", () => {
    const environments = parseEnvironmentList(readFixture("environment-list.txt"));

    expect(environments).toEqual([
      {
        id: "acme-demo-env-main",
        title: "Main",
        status: "active",
        type: "production",
        created: "2026-01-01T00:00:00+00:00",
        machine_name: "main-7demo0",
        updated: "2026-01-02T00:00:00+00:00",
      },
      {
        id: "acme-demo-env-stage",
        title: "Staging",
        status: "active",
        type: "staging",
        created: "2026-01-03T00:00:00+00:00",
        machine_name: "stage-7demo0",
        updated: "2026-01-04T00:00:00+00:00",
      },
    ]);
  });

  it("declares its own REQUIRED_HEADERS", () => {
    expect(ENVIRONMENT_LIST_REQUIRED_HEADERS).toEqual(["id", "title", "status", "type", "created", "machine_name", "updated"]);
  });

  it("POSITIVE CONTROL: output missing a required header still throws", () => {
    expect(() => parseEnvironmentList("ID\tTitle\tStatus\tType\nacme-demo-env-main\tMain\tactive\tproduction\n")).toThrow(
      MagentoCloudOutputShapeError,
    );
  });
});

// The CLI's own `environment:list` column list is wider than the seven asked
// for here. The extra column is appended HERE rather than written into the
// fixture, so the fixture keeps matching the header row the CLI really prints.
const ENVIRONMENT_LIST_UNDECLARED_MARKER = "DEMOENVIRONMENTPROJECT";
const environmentListWithUndeclaredColumn = () =>
  "ID\tTitle\tStatus\tType\tCreated\tMachine name\tUpdated\tProject\n" +
  `acme-demo-env-main\tMain\tactive\tproduction\t2026-01-01T00:00:00+00:00\tmain-7demo0\t2026-01-02T00:00:00+00:00\t${ENVIRONMENT_LIST_UNDECLARED_MARKER}\n`;

describe("parseEnvironmentList — undeclared columns", () => {
  // The strongest proof here runs on the SERIALIZED result, not the in-memory
  // object: a narrow return type is a compile-time claim only, and
  // `rowsToRecords` keys a record by EVERY header the CLI printed.
  it("cannot leak an undeclared column even through JSON.stringify", () => {
    const serialized = JSON.stringify(parseEnvironmentList(environmentListWithUndeclaredColumn()));

    expect(serialized).not.toMatch(/project/i);
    expect(serialized).not.toContain(ENVIRONMENT_LIST_UNDECLARED_MARKER);
  });

  // POSITIVE CONTROL: the same probe must find the marker in the raw text.
  it("positive control: the same probe finds the undeclared column in the raw CLI output", () => {
    const raw = environmentListWithUndeclaredColumn();

    expect(raw).toMatch(/project/i);
    expect(raw).toContain(ENVIRONMENT_LIST_UNDECLARED_MARKER);
  });
});

describe("parseEnvironmentInfo", () => {
  // CHANGED DELIBERATELY: this assertion used to list every flat scalar the
  // fixture carries, encoding the "pass the rest through" behaviour that would
  // have handed a caller `http_access` — under which real output nests a
  // `basic_auth` block. The parser now projects an allowlist.
  //
  // The fixture's `sizing` and `crons` blocks were never ingested: each is a
  // bare key line followed by indented YAML continuation lines, none of them a
  // top-level `key<TAB>value` pair.
  it("maps environment:info to its allowlisted fields, dropping every other key the CLI printed", () => {
    const environment = parseEnvironmentInfo(readFixture("environment-info.txt"));

    expect(environment).toEqual({
      id: "acme-demo-env-main",
      status: "active",
      type: "production",
      name: "main",
      machine_name: "main-7demo0",
      title: "Main",
      parent: "",
      created_at: "2026-01-01T00:00:00+00:00",
      updated_at: "2026-01-02T00:00:00+00:00",
      default_domain: "",
      edge_hostname: "acme-demo-env-main-acme-demo-project.demo-region.example-domain",
      has_domains: "true",
      is_pr: "false",
      has_remote: "true",
      deployment_target: "local",
    });
    expect(environment).not.toHaveProperty("http_access");
    expect(environment).not.toHaveProperty("clone_parent_on_create");
    expect(environment).not.toHaveProperty("enable_smtp");
    expect(environment).not.toHaveProperty("restrict_robots");
    expect(environment).not.toHaveProperty("max_instance_count");
    expect(environment).not.toHaveProperty("sizing");
    expect(environment).not.toHaveProperty("crons");
    expect(environment).not.toHaveProperty("Property");
  });

  it("POSITIVE CONTROL: output missing a required key still throws", () => {
    expect(() => parseEnvironmentInfo("Property\tValue\nid\tacme-demo-env-main\n")).toThrow(MagentoCloudOutputShapeError);
  });
});

// `environment:url` REJECTS `--format` outright ("The \"--format\" option
// does not exist."), so its output is never TSV and has no header row. With
// `--pipe` it prints one bare URL per line, and an environment routinely has
// more than one.
describe("parseEnvironmentUrls", () => {
  it("returns every bare --pipe line, in the order the CLI printed them", () => {
    expect(parseEnvironmentUrls(readFixture("environment-url.txt"))).toEqual([
      "https://acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
      "https://www.acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
    ]);
  });

  it("returns an empty list for empty output rather than inventing a URL", () => {
    expect(parseEnvironmentUrls("\n")).toEqual([]);
  });
});

describe("parseEnvironmentUrl", () => {
  it("returns the first URL the CLI printed", () => {
    expect(parseEnvironmentUrl(readFixture("environment-url.txt"))).toBe(
      "https://acme-demo-env-main-acme-demo-project.demo-region.example-domain/",
    );
  });

  it("POSITIVE CONTROL: throws rather than returning an empty string when the CLI printed no URL", () => {
    expect(() => parseEnvironmentUrl("\n")).toThrow(MagentoCloudOutputShapeError);
  });
});

// `http_access` is the notable exclusion: the real output nests a `basic_auth`
// block under it. The probe flattens that into one top-level pair, so the
// assertion is about what this parser KEEPS rather than about a quirk of the
// nested-block reader, and the fixture's own undeclared scalars
// (`enable_smtp`, `max_instance_count`, ...) are probed alongside it.
const ENVIRONMENT_INFO_UNDECLARED_PAIRS = "http_access\tbasic_auth demo-user DEMOBASICAUTH\n";

const environmentInfoWithUndeclaredPairs = () => readFixture("environment-info.txt") + ENVIRONMENT_INFO_UNDECLARED_PAIRS;

describe("parseEnvironmentInfo — undeclared keys", () => {
  // The strongest proof here runs on the SERIALIZED result, not the in-memory
  // object: the narrow return type is a compile-time claim only.
  it("cannot leak an undeclared key even through JSON.stringify", () => {
    const serialized = JSON.stringify(parseEnvironmentInfo(environmentInfoWithUndeclaredPairs()));

    expect(serialized).not.toContain("http_access");
    expect(serialized).not.toContain("DEMOBASICAUTH");
    expect(serialized).not.toContain("enable_smtp");
    expect(serialized).not.toContain("restrict_robots");
    expect(serialized).not.toContain("max_instance_count");
    expect(serialized).not.toContain("clone_parent_on_create");
  });

  // POSITIVE CONTROL: the same probe must find every marker in the raw text.
  it("positive control: the same probe finds each dropped key in the raw CLI output", () => {
    const raw = environmentInfoWithUndeclaredPairs();

    expect(raw).toContain("http_access");
    expect(raw).toContain("DEMOBASICAUTH");
    expect(raw).toContain("enable_smtp");
    expect(raw).toContain("restrict_robots");
    expect(raw).toContain("max_instance_count");
    expect(raw).toContain("clone_parent_on_create");
  });
});
