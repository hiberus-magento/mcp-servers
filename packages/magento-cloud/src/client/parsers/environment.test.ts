// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MagentoCloudOutputShapeError } from "../errors.js";
import { parseEnvironmentInfo, parseEnvironmentList, parseEnvironmentUrl, parseEnvironmentUrls } from "./environment.js";

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
