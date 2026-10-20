// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The manifest cannot be allowed to disagree with the code: `gen-readme.mjs`
// publishes `requires.env` straight into README.md, so a wrong entry is a
// wrong instruction to every user of the package.
//
// The first block exercises the scanner against hand-built sources (so its
// own failure path is drivable, the pattern `verify-bundle.mjs` and
// `conformance.ts` already use); the second runs it against the real
// `servers.json` and the real package sources.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectSourceEnvNames, declaredEnvNames, diffServerEnv, envPrefixForDomain, requiredEnvNames } from "./manifest-env.mjs";
import { loadServersManifest } from "./validate-manifest.mjs";

function writePackage(files) {
  const root = mkdtempSync(join(tmpdir(), "manifest-env-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const full = join(root, relativePath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents, "utf8");
  }
  return root;
}

describe("envPrefixForDomain", () => {
  it("derives the prefix from the manifest's own domain, hyphens included", () => {
    expect(envPrefixForDomain("eds")).toBe("EDS_");
    expect(envPrefixForDomain("magento-cloud")).toBe("MAGENTO_CLOUD_");
  });
});

describe("collectSourceEnvNames", () => {
  it("sees a dotted read, a literal-indexed read, and a constant-indexed read", () => {
    const root = writePackage({
      "src/a.ts": 'const NAME_ENV_VAR = "DEMO_INDIRECT";\nconst x = process.env.DEMO_DOTTED;\nconst y = process.env["DEMO_LITERAL"];\nconst z = process.env[NAME_ENV_VAR];\n',
    });
    expect(collectSourceEnvNames(join(root, "src"))).toEqual(new Set(["DEMO_DOTTED", "DEMO_LITERAL", "DEMO_INDIRECT"]));
  });

  it("follows a constant defined in one file and indexed in another", () => {
    const root = writePackage({
      "src/credential-provider.ts": 'export const DEMO_TOKEN_ENV_VAR = "DEMO_TOKEN";\n',
      "src/cli.ts": 'import { DEMO_TOKEN_ENV_VAR } from "./credential-provider.js";\nconst t = process.env[DEMO_TOKEN_ENV_VAR];\n',
    });
    expect(collectSourceEnvNames(join(root, "src"))).toContain("DEMO_TOKEN");
  });

  it("counts an *_ENV_VAR constant even when this package never indexes process.env with it", () => {
    // The real shape: the name is handed to mcp-core's
    // `resolveCredentialValue({ envVar })`, which performs the read.
    const root = writePackage({
      "src/credential-provider.ts": 'export const DEMO_ENV_VAR = "DEMO_DELEGATED";\nresolveCredentialValue({ envVar: DEMO_ENV_VAR });\n',
    });
    expect(collectSourceEnvNames(join(root, "src"))).toContain("DEMO_DELEGATED");
  });

  it("ignores test files, so a variable only a test sets up is not mistaken for a published one", () => {
    const root = writePackage({
      "src/a.ts": "const x = process.env.DEMO_REAL;\n",
      "src/a.test.ts": "process.env.DEMO_TEST_ONLY = 'x';\nconst y = process.env.DEMO_TEST_ONLY;\n",
      "src/a.test-d.ts": "const z = process.env.DEMO_TYPE_ONLY;\n",
    });
    expect(collectSourceEnvNames(join(root, "src"))).toEqual(new Set(["DEMO_REAL"]));
  });
});

describe("diffServerEnv", () => {
  const server = { id: "demo", domain: "demo", requires: { env: [{ name: "DEMO_DECLARED", required: true }] } };

  it("reports a declared variable no source reads", () => {
    const packagesDir = writePackage({ "demo/src/a.ts": "const x = 1;\n" });
    expect(diffServerEnv(server, packagesDir).declaredButUnread).toEqual(["DEMO_DECLARED"]);
  });

  it("reports a variable the source reads and the manifest never mentions", () => {
    const packagesDir = writePackage({ "demo/src/a.ts": "const x = process.env.DEMO_DECLARED;\nconst y = process.env.DEMO_SECRET;\n" });
    expect(diffServerEnv(server, packagesDir).readButUndeclared).toEqual(["DEMO_SECRET"]);
  });

  it("is clean when the two sides agree", () => {
    const packagesDir = writePackage({ "demo/src/a.ts": "const x = process.env.DEMO_DECLARED;\n" });
    const diff = diffServerEnv(server, packagesDir);
    expect(diff.declaredButUnread).toEqual([]);
    expect(diff.readButUndeclared).toEqual([]);
  });

  it("surfaces a declared name outside the server's own prefix instead of silently skipping it", () => {
    const offPrefix = { id: "demo", domain: "demo", requires: { env: [{ name: "UNRELATED_TOKEN", required: true }] } };
    const packagesDir = writePackage({ "demo/src/a.ts": "const x = 1;\n" });
    expect(diffServerEnv(offPrefix, packagesDir).declaredOutsidePrefix).toEqual(["UNRELATED_TOKEN"]);
  });
});

describe("servers.json agrees with the packages it describes", () => {
  const manifest = loadServersManifest();

  for (const server of manifest.servers) {
    it(`${server.id}: declares exactly the ${envPrefixForDomain(server.domain)}* variables its sources read`, () => {
      const diff = diffServerEnv(server);
      expect(diff.declaredOutsidePrefix, `declared outside the ${envPrefixForDomain(server.domain)} prefix, so unverifiable here`).toEqual([]);
      expect(diff.readButUndeclared, "read by packages/" + server.id + "/src but absent from servers.json").toEqual([]);
      expect(diff.declaredButUnread, "declared in servers.json but no source under packages/" + server.id + "/src reads it").toEqual([]);
    });

    it(`${server.id}: every declared variable carries an explicit required flag and a description`, () => {
      for (const entry of server.requires?.env ?? []) {
        expect(typeof entry.required, `${entry.name} has no boolean "required"`).toBe("boolean");
        expect(entry.description ?? "", `${entry.name} has no description`).not.toBe("");
      }
    });

    it(`${server.id}: the required set is a subset of the declared set`, () => {
      const declared = declaredEnvNames(server);
      for (const name of requiredEnvNames(server)) {
        expect(declared.has(name)).toBe(true);
      }
    });
  }
});
