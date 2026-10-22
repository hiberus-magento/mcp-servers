// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 11.2: a valid servers.json entry passes
// schema validation; an entry missing a required field fails and names it.
import { existsSync, readFileSync } from "node:fs";
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

// Nothing in this repository could see that all three published packages had
// a bare npm page: no description, no keywords, no repository link, no README.
// It was invisible until a human opened npmjs.com. These fields are not
// decoration — `repository.directory` is what makes npm link to the right
// subfolder of a monorepo, and `keywords` is the only way someone searching
// for an "adobe commerce mcp server" finds this at all.
const REQUIRED_PACKAGE_METADATA = ["description", "keywords", "repository", "homepage", "bugs", "author", "license", "engines"];
const REPOSITORY_URL = "git+https://github.com/hiberus-magento/mcp-servers.git";

describe("every package servers.json publishes carries its npm metadata", () => {
  const manifest = loadServersManifest();

  for (const server of manifest.servers) {
    const packageJsonPath = fileURLToPath(new URL(`../packages/${server.id}/package.json`, import.meta.url));
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

    it(`${server.id}: declares every field npm renders on a package page`, () => {
      const missing = REQUIRED_PACKAGE_METADATA.filter((field) => pkg[field] === undefined);
      expect(missing, `packages/${server.id}/package.json is missing: ${missing.join(", ")}`).toEqual([]);
      expect(pkg.license).toBe("Apache-2.0");
      expect(Array.isArray(pkg.keywords) && pkg.keywords.length > 0).toBe(true);
    });

    // A `repository` without `directory` makes npm link a monorepo package to
    // the repository root, where there is no sign of this package at all.
    it(`${server.id}: points npm at its own subfolder of the monorepo`, () => {
      expect(pkg.repository.url).toBe(REPOSITORY_URL);
      expect(pkg.repository.directory).toBe(`packages/${server.id}`);
    });

    // The README is the npm page. `files` controls the tarball, and the
    // packaging gate's G9 checks the packed artifact; this checks the
    // declaration, so the two cannot disagree about intent.
    it(`${server.id}: has a README.md and ships it`, () => {
      const readmePath = fileURLToPath(new URL(`../packages/${server.id}/README.md`, import.meta.url));
      expect(existsSync(readmePath), `packages/${server.id}/README.md does not exist`).toBe(true);
      expect(pkg.files).toContain("README.md");
    });
  }
});

// `pnpm new-server` has now twice scaffolded a package that then had to be
// fixed up by hand — once for the packaging gate, once for the version string.
// A scaffold that is bare on day one is the same defect a third time.
describe("templates/server scaffolds a package that is not bare on day one", () => {
  const template = JSON.parse(readFileSync(fileURLToPath(new URL("../templates/server/package.json", import.meta.url)), "utf8"));

  it("declares every field npm renders on a package page", () => {
    const missing = REQUIRED_PACKAGE_METADATA.filter((field) => template[field] === undefined);
    expect(missing, `templates/server/package.json is missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("leaves repository.directory as a token new-server substitutes", () => {
    expect(template.repository.url).toBe(REPOSITORY_URL);
    expect(template.repository.directory).toBe("packages/__NAME__");
  });

  it("ships a README.md skeleton carrying the generator's markers", () => {
    expect(template.files).toContain("README.md");
    const readme = readFileSync(fileURLToPath(new URL("../templates/server/README.md", import.meta.url)), "utf8");
    expect(readme).toContain("<!-- package:start -->");
    expect(readme).toContain("<!-- package:end -->");
  });
});

// `engines` is a claim about what this package runs on. Three places already
// encode "Node 22" — the root package.json, .nvmrc, and tsup's build target —
// and a fourth copy that drifts tells npm the wrong thing.
describe("engines agrees with the rest of the repository's Node 22 target", () => {
  const rootEngines = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")).engines.node;
  const nvmrc = readFileSync(fileURLToPath(new URL("../.nvmrc", import.meta.url)), "utf8").trim();

  it("the root declares the same range every package declares", () => {
    expect(rootEngines).toBe(">=22");
  });

  it(".nvmrc names the same major version", () => {
    expect(nvmrc).toBe("22");
  });

  for (const server of loadServersManifest().servers) {
    it(`${server.id}: engines.node matches the root, and tsup targets the same major`, () => {
      const pkg = JSON.parse(readFileSync(fileURLToPath(new URL(`../packages/${server.id}/package.json`, import.meta.url)), "utf8"));
      expect(pkg.engines.node).toBe(rootEngines);
      const tsup = readFileSync(fileURLToPath(new URL(`../packages/${server.id}/tsup.config.ts`, import.meta.url)), "utf8");
      expect(tsup, `packages/${server.id}/tsup.config.ts does not target node${nvmrc}`).toContain(`target: "node${nvmrc}"`);
    });
  }
});
