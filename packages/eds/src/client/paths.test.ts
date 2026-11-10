// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.7): `code` endpoints address by GitHub
// `{owner}/{repo}`, distinct from the `{org}/{site}` shape used everywhere
// else, and snapshot paths are pinned to `main` — they accept no `ref`
// parameter at all (eds-client spec, "Domain-Specific Address Shapes").
import { describe, expect, it } from "vitest";
import { codePath, sitePath, snapshotPath } from "./paths.js";

describe("codePath", () => {
  it("addresses code endpoints by owner/repo, not org/site", () => {
    const path = codePath({ owner: "example-owner", repo: "example-repo", ref: "main", file: "/head.html" });

    // CHANGED DELIBERATELY (eds-write-surface tasks.md 2.10): the contract
    // path is `/code/{owner}/{repo}/{ref}/{path}`; the `{ref}` segment was
    // missing.
    expect(path).toBe("/code/example-owner/example-repo/main/head.html");
    expect(path).not.toContain("acme-demo-org");
  });
});

describe("snapshotPath", () => {
  it("is fixed under main with no ref parameter accepted", () => {
    const path = snapshotPath({ org: "acme-demo-org", site: "acme-demo-site-eu", id: "launch-2026" });

    expect(path).toBe("/snapshot/acme-demo-org/acme-demo-site-eu/main/launch-2026");
  });

  it("accepts no ref field at the type level", () => {
    // @ts-expect-error — snapshot paths are pinned to main; `ref` is not a valid field here.
    snapshotPath({ org: "acme-demo-org", site: "acme-demo-site-eu", id: "launch-2026", ref: "feature-branch" });
  });
});

describe("sitePath", () => {
  it("uses the org/site/ref shape", () => {
    const path = sitePath({ resource: "status", org: "acme-demo-org", site: "acme-demo-site-eu", ref: "main", suffix: "/status.json" });

    expect(path).toBe("/status/acme-demo-org/acme-demo-site-eu/main/status.json");
  });
});
