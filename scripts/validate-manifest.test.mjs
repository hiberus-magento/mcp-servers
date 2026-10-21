// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 11.2: a valid servers.json entry passes
// schema validation; an entry missing a required field fails and names it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadServersManifest, validateServersManifest } from "./validate-manifest.mjs";

function validEntry() {
  return {
    id: "example-domain",
    package: "@hiberus-magento/example-domain",
    bin: "example-domain",
    version: "0.0.0",
    domain: "example",
    status: "internal",
    description: "A synthetic example server used only in tests.",
    tools: [{ name: "noop", readOnly: true, description: "Does nothing." }],
  };
}

describe("validateServersManifest", () => {
  it("passes for a manifest with one fully-populated entry", () => {
    const result = validateServersManifest({ servers: [validEntry()] });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails and names the missing field when description is absent", () => {
    const entry = validEntry();
    delete entry.description;
    const result = validateServersManifest({ servers: [entry] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("description"))).toBe(true);
  });
});

// The schema can only say `version` is a string; it cannot say WHICH string.
// `gen-readme.mjs` renders it straight into README.md's install snippet as
// `npx -y <package>@<version>`, so a manifest version that disagrees with the
// package's own is a README that tells people to install a version that does
// not exist. Versions are bumped by `changeset version`, which rewrites
// package.json and never touches servers.json — exactly the drift this
// catches, in the same spirit as the `requires.env` check in
// `manifest-env.test.mjs`.
describe("servers.json's version matches the package it names", () => {
  const manifest = loadServersManifest();

  it("describes at least one server, so the cases below are not vacuous", () => {
    expect(manifest.servers.length).toBeGreaterThan(0);
  });

  for (const server of manifest.servers) {
    it(`${server.id}: servers.json and packages/${server.id}/package.json agree on the version`, () => {
      const packageJsonPath = fileURLToPath(new URL(`../packages/${server.id}/package.json`, import.meta.url));
      const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      expect(pkg.name, `servers.json names ${server.package} but packages/${server.id} is ${pkg.name}`).toBe(server.package);
      expect(
        server.version,
        `servers.json pins ${server.version} but packages/${server.id}/package.json is ${pkg.version} — run "node scripts/gen-readme.mjs" after syncing servers.json to the version changesets produced`,
      ).toBe(pkg.version);
    });
  }
});
