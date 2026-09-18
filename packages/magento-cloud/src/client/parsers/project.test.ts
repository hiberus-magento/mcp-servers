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
  // CHANGED DELIBERATELY: `project:list` is now invoked with an explicit
  // `--columns id,title,region,status,created_at` set (`../commands.ts`), so
  // the real header row gained `Status` and `Created` — the cell `created_at`
  // produces is headed `Created`, not `Created at`.
  it("maps project:list rows keyed by the CLI's own header names", () => {
    const projects = parseProjectList(readFixture("project-list.txt"));

    expect(projects).toEqual([
      {
        id: "acme-demo-project",
        title: "Demo Storefront",
        region: "demo-region.example-domain",
        status: "active",
        created: "2026-01-01T00:00:00+00:00",
      },
    ]);
  });

  it("declares its own REQUIRED_HEADERS", () => {
    expect(PROJECT_LIST_REQUIRED_HEADERS).toEqual(["id", "title", "region", "status", "created"]);
  });

  it("POSITIVE CONTROL: output missing a required header still throws", () => {
    expect(() => parseProjectList("ID\tTitle\tRegion\nacme-demo-project\tDemo Storefront\tdemo-region.example-domain\n")).toThrow(
      MagentoCloudOutputShapeError,
    );
  });
});

// `project:list` also offers `organization_id`, `organization_label`,
// `organization_name` and `organization_type` — every one of them naming the
// customer's organization. `--columns` means they are not requested; this
// suite proves the parser would not hand one on even if it arrived anyway (a
// CLI default change, a dropped flag, an operator running it by hand). The
// extra column is appended HERE rather than written into the fixture, so the
// fixture keeps matching the header row the CLI really prints.
const PROJECT_LIST_ORGANIZATION_MARKER = "DEMOORGANIZATIONLABEL";
const projectListWithOrganizationColumn = () =>
  "ID\tTitle\tRegion\tStatus\tCreated\tOrganization label\n" +
  `acme-demo-project\tDemo Storefront\tdemo-region.example-domain\tactive\t2026-01-01T00:00:00+00:00\t${PROJECT_LIST_ORGANIZATION_MARKER}\n`;

describe("parseProjectList — undeclared columns", () => {
  // The strongest proof here runs on the SERIALIZED result, not the in-memory
  // object: a narrow return type is a compile-time claim only, and
  // `rowsToRecords` keys a record by EVERY header the CLI printed.
  it("cannot leak an undeclared column even through JSON.stringify", () => {
    const serialized = JSON.stringify(parseProjectList(projectListWithOrganizationColumn()));

    expect(serialized).not.toMatch(/organization/i);
    expect(serialized).not.toContain(PROJECT_LIST_ORGANIZATION_MARKER);
  });

  // POSITIVE CONTROL: the same probe must find the marker in the raw text.
  // Without this, a probe that simply cannot see the column would "pass".
  it("positive control: the same probe finds the undeclared column in the raw CLI output", () => {
    const raw = projectListWithOrganizationColumn();

    expect(raw).toMatch(/organization/i);
    expect(raw).toContain(PROJECT_LIST_ORGANIZATION_MARKER);
  });
});

describe("parseProjectInfo", () => {
  // CHANGED DELIBERATELY: this assertion used to list every flat scalar the
  // fixture carries, encoding the "pass the rest through" behaviour that let
  // `client_ssh_key` and `subscription_management_uri` reach a caller. The
  // parser now projects an allowlist, so the assertion names it.
  //
  // The fixture's two NESTED blocks (`subscription`, `git`) were never
  // ingested — the CLI renders them as a bare key line followed by indented
  // YAML continuation lines, and neither is a top-level `key<TAB>value` pair,
  // any more than the leading `Property`/`Value` header row is.
  it("maps project:info to its allowlisted fields, dropping every other key the CLI printed", () => {
    const project = parseProjectInfo(readFixture("project-info.txt"));

    expect(project).toEqual({
      id: "acme-demo-project",
      title: "Demo Storefront",
      region: "demo-region.example-domain",
      status: "active",
      created_at: "2026-01-01T00:00:00+00:00",
      updated_at: "2026-01-02T00:00:00+00:00",
      default_branch: "main",
      timezone: "UTC",
      default_domain: "",
    });
    expect(project).not.toHaveProperty("owner");
    expect(project).not.toHaveProperty("organization");
    expect(project).not.toHaveProperty("description");
    expect(project).not.toHaveProperty("namespace");
    expect(project).not.toHaveProperty("repository");
    expect(project).not.toHaveProperty("url");
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

// A live smoke test confirmed the real `project:info` prints SSH public key
// material and a billing URI as TOP-LEVEL pairs. Those pairs are appended
// HERE rather than written into the fixture, so the fixture keeps matching
// the output a maintainer actually recaptures, and so the leak probe and its
// positive control read one and the same text.
const PROJECT_INFO_UNDECLARED_PAIRS =
  "client_ssh_key\tssh-rsa DEMOKEYMATERIAL demo@example-domain\nsubscription_management_uri\thttps://accounts.demo-region.example-domain/sub-demo-0001\n";

const projectInfoWithUndeclaredPairs = () => readFixture("project-info.txt") + PROJECT_INFO_UNDECLARED_PAIRS;

describe("parseProjectInfo — undeclared keys", () => {
  // The strongest proof here runs on the SERIALIZED result, not the in-memory
  // object: the narrow return type is a compile-time claim only, so only
  // `JSON.stringify` shows what an agent would actually receive.
  it("cannot leak an undeclared key even through JSON.stringify", () => {
    const serialized = JSON.stringify(parseProjectInfo(projectInfoWithUndeclaredPairs()));

    expect(serialized).not.toContain("client_ssh_key");
    expect(serialized).not.toContain("DEMOKEYMATERIAL");
    expect(serialized).not.toContain("subscription_management_uri");
    expect(serialized).not.toContain("repository");
    expect(serialized).not.toContain("namespace");
  });

  // POSITIVE CONTROL: the leak test above proves nothing unless the same
  // probe detects, in the raw CLI output, every marker it claims to catch.
  it("positive control: the same probe finds each dropped key in the raw CLI output", () => {
    const raw = projectInfoWithUndeclaredPairs();

    expect(raw).toContain("client_ssh_key");
    expect(raw).toContain("DEMOKEYMATERIAL");
    expect(raw).toContain("subscription_management_uri");
    expect(raw).toContain("repository");
    expect(raw).toContain("namespace");
  });
});
