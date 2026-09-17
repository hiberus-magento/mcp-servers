// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2). Each parser declares its own
// `REQUIRED_HEADERS`; row mapper output keyed by header name.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
  it("maps project:info's field/value rows into a single record", () => {
    const project = parseProjectInfo(readFixture("project-info.txt"));

    expect(project).toEqual({ id: "acme-demo-project", title: "Demo Storefront", region: "demo-region.example-domain" });
  });

  it("declares its own required keys", () => {
    expect(PROJECT_INFO_REQUIRED_KEYS).toEqual(["id", "title", "region"]);
  });
});
