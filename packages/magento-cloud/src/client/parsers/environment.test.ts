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
  // The fixture's `sizing` and `crons` blocks are nested: a bare key line
  // followed by indented YAML continuation lines, none of them a top-level
  // `key<TAB>value` pair. The flat scalars are what this parser claims.
  it("maps environment:info's flat field/value rows, ignoring the header row and every nested block", () => {
    const environment = parseEnvironmentInfo(readFixture("environment-info.txt"));

    expect(environment).toEqual({
      id: "acme-demo-env-main",
      created_at: "2026-01-01T00:00:00+00:00",
      updated_at: "2026-01-02T00:00:00+00:00",
      name: "main",
      machine_name: "main-7demo0",
      title: "Main",
      type: "production",
      parent: "",
      default_domain: "",
      has_domains: "true",
      clone_parent_on_create: "true",
      deployment_target: "local",
      is_pr: "false",
      has_remote: "true",
      status: "active",
      http_access: "",
      enable_smtp: "true",
      restrict_robots: "false",
      edge_hostname: "acme-demo-env-main-acme-demo-project.demo-region.example-domain",
      max_instance_count: "1",
    });
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
