// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2). Each parser declares its own
// `REQUIRED_HEADERS`; row mapper output keyed by header name.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MagentoCloudOutputShapeError } from "../errors.js";
import { parseProjectInfo, parseProjectList, PROJECT_INFO_REQUIRED_KEYS, PROJECT_LIST_REQUIRED_HEADERS } from "./project.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseProjectList", () => {
  it("maps project:list rows keyed by the CLI's own header names", () => {
    const projects = parseProjectList(readFixture("project-list.txt"));

    expect(projects).toEqual([{ id: "acme-demo-project", title: "Demo Storefront", region: "demo-region.example-domain" }]);
  });

  it("declares its own REQUIRED_HEADERS", () => {
    expect(PROJECT_LIST_REQUIRED_HEADERS).toEqual(["id", "title", "region"]);
  });
});

describe("parseProjectInfo", () => {
  // The fixture carries two NESTED blocks (`subscription`, `git`), which the
  // CLI renders as a bare key line followed by indented YAML continuation
  // lines. Neither the block name nor its continuation lines are top-level
  // `key<TAB>value` pairs, so neither is ingested — and the leading
  // `Property`/`Value` header row is not a pair either.
  it("maps project:info's flat field/value rows, ignoring the header row and every nested block", () => {
    const project = parseProjectInfo(readFixture("project-info.txt"));

    expect(project).toEqual({
      id: "acme-demo-project",
      created_at: "2026-01-01T00:00:00+00:00",
      updated_at: "2026-01-02T00:00:00+00:00",
      title: "Demo Storefront",
      description: "",
      owner: "acct-demo-0001",
      namespace: "acme",
      organization: "org-demo-0001",
      default_branch: "main",
      status: "active",
      timezone: "UTC",
      region: "demo-region.example-domain",
      repository: "demo-user@git.demo-region.example-domain:acme-demo-project.git",
      default_domain: "",
      url: "https://console.demo-region.example-domain/acme/acme-demo-project",
    });
    expect(project).not.toHaveProperty("subscription");
    expect(project).not.toHaveProperty("Property");
  });

  it("POSITIVE CONTROL: output missing a required key still throws", () => {
    expect(() => parseProjectInfo("Property\tValue\nid\tacme-demo-project\n")).toThrow(MagentoCloudOutputShapeError);
  });

  it("declares its own required keys", () => {
    expect(PROJECT_INFO_REQUIRED_KEYS).toEqual(["id", "title", "region"]);
  });
});
