// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 4.1, 4.12; eds-mcp spec, "eds_plan
// Supports Every Write Operation Kind", "eds_apply Accepts Only a Token",
// "Bulk Write paths Is Non-Empty", "API Key Writes Stay Off the MCP
// Surface"): the schema is the first gate — anything it rejects never
// reaches a handler, so nothing is read or written for it.
import { describe, expect, it } from "vitest";
import { edsApplyInput, edsPlanInput, OPERATION_KINDS } from "./plan.js";

const SITE = "acme-demo-site-eu";

function plan(operation: unknown, extra: Record<string, unknown> = {}) {
  return edsPlanInput.safeParse({ site: SITE, operation, ...extra });
}

/** One minimal valid operation per kind. */
const VALID: Record<string, unknown> = {
  "config.patch": { kind: "config.patch", patch: { a: 1 } },
  "site.create": { kind: "site.create", config: { code: { owner: "example-owner", repo: "example-repo" } } },
  "site.delete": { kind: "site.delete" },
  "version.restore": { kind: "version.restore", versionId: "3" },
  "robots.set": { kind: "robots.set", content: "User-agent: *" },
  "preview.update": { kind: "preview.update", paths: ["/a"] },
  "preview.delete": { kind: "preview.delete", paths: ["/a"] },
  "live.publish": { kind: "live.publish", paths: ["/a"] },
  "live.unpublish": { kind: "live.unpublish", paths: ["/a"] },
  "index.update": { kind: "index.update", paths: ["/a"] },
  "index.delete": { kind: "index.delete", paths: ["/a"] },
  "index.full-site": { kind: "index.full-site", confirmFullReindex: true },
  "cache.purge": { kind: "cache.purge", paths: ["/a"] },
  "sitemap.rebuild": { kind: "sitemap.rebuild", path: "/sitemap.xml" },
  "code.sync": { kind: "code.sync", paths: ["/scripts/a.js"] },
  "code.delete": { kind: "code.delete", paths: ["/scripts/a.js"] },
  "job.stop": { kind: "job.stop", topic: "live", name: "job-demo" },
  "snapshot.add": { kind: "snapshot.add", id: "launch-demo", paths: ["/a"] },
  "snapshot.remove": { kind: "snapshot.remove", id: "launch-demo", paths: ["/a"] },
  "snapshot.publish": { kind: "snapshot.publish", id: "launch-demo" },
  "snapshot.review": { kind: "snapshot.review", id: "launch-demo", reviewAction: "approve" },
  "snapshot.delete": { kind: "snapshot.delete", id: "launch-demo" },
};

describe("edsPlanInput — the 22 kinds", () => {
  it("declares exactly the 22 kinds in the spec", () => {
    expect([...OPERATION_KINDS].sort()).toEqual(Object.keys(VALID).sort());
    expect(OPERATION_KINDS).toHaveLength(22);
  });

  it.each(Object.entries(VALID))("accepts a minimal valid %s", (_kind, operation) => {
    expect(plan(operation).success).toBe(true);
  });

  it.each(Object.entries(VALID))("rejects a stray field on %s (every branch is strict)", (_kind, operation) => {
    expect(plan({ ...(operation as object), stray: true }).success).toBe(false);
  });

  it.each([["site.rename"], ["key.create"], ["key.delete"], ["auth.mint"], [""]])("rejects the kind %j", (kind) => {
    expect(plan({ kind, id: "key-demo-1" }).success).toBe(false);
  });

  it("rejects a stray top-level field", () => {
    expect(plan(VALID["site.delete"], { org: "acme-demo-org" }).success).toBe(false);
  });

  it("accepts an optional ref", () => {
    expect(plan(VALID["live.publish"], { ref: "main" }).success).toBe(true);
  });
});

describe("edsPlanInput — paths", () => {
  const PATH_KINDS = ["preview.update", "preview.delete", "live.publish", "live.unpublish", "index.update", "index.delete", "cache.purge", "code.sync", "code.delete", "snapshot.remove"];

  it.each(PATH_KINDS)("%s rejects omitted, empty and over-100 paths", (kind) => {
    expect(plan({ kind }).success).toBe(false);
    expect(plan({ kind, paths: [] }).success).toBe(false);
    expect(plan({ kind, paths: Array.from({ length: 101 }, (_, i) => `/p${i}`) }).success).toBe(false);
    expect(plan({ kind, paths: [""] }).success).toBe(false);
  });

  it("accepts exactly 100 paths", () => {
    expect(plan({ kind: "live.publish", paths: Array.from({ length: 100 }, (_, i) => `/p${i}`) }).success).toBe(true);
  });

  it("snapshot.add may omit paths but not send an empty array", () => {
    expect(plan({ kind: "snapshot.add", id: "launch-demo" }).success).toBe(true);
    expect(plan({ kind: "snapshot.add", id: "launch-demo", paths: [] }).success).toBe(false);
  });
});

describe("edsPlanInput — per-kind gates", () => {
  it("index.full-site requires the literal confirmFullReindex: true", () => {
    expect(plan({ kind: "index.full-site" }).success).toBe(false);
    expect(plan({ kind: "index.full-site", confirmFullReindex: false }).success).toBe(false);
    expect(plan({ kind: "index.full-site", confirmFullReindex: "true" }).success).toBe(false);
  });

  it("index.full-site takes no paths", () => {
    expect(plan({ kind: "index.full-site", confirmFullReindex: true, paths: ["/a"] }).success).toBe(false);
  });

  it.each(["owner", "repo"])("code.* rejects a model-supplied %s", (field) => {
    expect(plan({ kind: "code.sync", paths: ["/scripts/a.js"], [field]: "other-owner" }).success).toBe(false);
    expect(plan({ kind: "code.delete", paths: ["/scripts/a.js"], [field]: "other-owner" }).success).toBe(false);
  });

  it("config.patch requires an object patch", () => {
    expect(plan({ kind: "config.patch" }).success).toBe(false);
    expect(plan({ kind: "config.patch", patch: [1] }).success).toBe(false);
    expect(plan({ kind: "config.patch", patch: "x" }).success).toBe(false);
    expect(plan({ kind: "config.patch", patch: null }).success).toBe(false);
  });

  it("site.create requires an object config", () => {
    expect(plan({ kind: "site.create" }).success).toBe(false);
    expect(plan({ kind: "site.create", config: [] }).success).toBe(false);
  });

  it("snapshot.review requires a reviewAction of approve or reject", () => {
    expect(plan({ kind: "snapshot.review", id: "launch-demo" }).success).toBe(false);
    expect(plan({ kind: "snapshot.review", id: "launch-demo", reviewAction: "maybe" }).success).toBe(false);
    expect(plan({ kind: "snapshot.review", id: "launch-demo", reviewAction: "reject", message: "no" }).success).toBe(true);
  });

  it("robots.set accepts an empty robots.txt but requires the field", () => {
    expect(plan({ kind: "robots.set" }).success).toBe(false);
    expect(plan({ kind: "robots.set", content: "" }).success).toBe(true);
  });
});

describe("edsApplyInput — only a token (4.12)", () => {
  it("accepts { token }, { token, confirmSite }, { token, wait }", () => {
    expect(edsApplyInput.safeParse({ token: "t" }).success).toBe(true);
    expect(edsApplyInput.safeParse({ token: "t", confirmSite: SITE, wait: true }).success).toBe(true);
  });

  it.each([
    [{ token: "t", site: "acme-demo-site-us" }],
    [{ token: "t", operation: { kind: "site.delete" } }],
    [{ token: "t", paths: ["/a"] }],
    [{}],
    [{ token: "" }],
  ])("rejects %j", (input) => {
    expect(edsApplyInput.safeParse(input).success).toBe(false);
  });
});
