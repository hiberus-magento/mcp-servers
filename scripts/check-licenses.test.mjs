// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 12.4: a GPL-3.0 dependency fails the license
// allowlist check and the failure names the offending package and license
// (release-pipeline spec, "License Allowlist Enforcement").
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkLicenseAllowlist, checkPackage, resolveBundledPackages, writeNoticesFor } from "./check-licenses.mjs";

let workDir;

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  }
});

function setup() {
  workDir = mkdtempSync(join(tmpdir(), "check-licenses-test-"));
  const packageDir = join(workDir, "pkg");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "pkg", version: "0.0.0" }), "utf8");

  const nodeModules = join(packageDir, "node_modules");
  mkdirSync(join(nodeModules, "good-pkg"), { recursive: true });
  writeFileSync(
    join(nodeModules, "good-pkg", "package.json"),
    JSON.stringify({ name: "good-pkg", version: "1.0.0", license: "MIT" }),
    "utf8",
  );
  mkdirSync(join(nodeModules, "gpl-pkg"), { recursive: true });
  writeFileSync(
    join(nodeModules, "gpl-pkg", "package.json"),
    JSON.stringify({ name: "gpl-pkg", version: "2.0.0", license: "GPL-3.0" }),
    "utf8",
  );

  const metafile = {
    inputs: {
      "node_modules/good-pkg/index.js": {},
      "node_modules/gpl-pkg/index.js": {},
    },
  };
  return { packageDir, metafile };
}

describe("resolveBundledPackages + checkLicenseAllowlist", () => {
  it("passes when every bundled package is inside the allowlist", () => {
    const { packageDir, metafile } = setup();
    metafile.inputs = { "node_modules/good-pkg/index.js": {} };
    const packages = resolveBundledPackages({ metafile, packageDir });
    const result = checkLicenseAllowlist(packages);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("fails and names the offending package and license for a GPL-3.0 dependency", () => {
    const { packageDir, metafile } = setup();
    const packages = resolveBundledPackages({ metafile, packageDir });
    const result = checkLicenseAllowlist(packages);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].name).toBe("gpl-pkg");
    expect(result.violations[0].license).toBe("GPL-3.0");
  });
});

describe("checkPackage THIRD-PARTY-NOTICES.txt gate (tasks.md 12.7)", () => {
  it("fails the check when THIRD-PARTY-NOTICES.txt is missing", () => {
    const { packageDir, metafile } = setup();
    metafile.inputs = { "node_modules/good-pkg/index.js": {} };
    mkdirSync(join(packageDir, "dist"), { recursive: true });
    writeFileSync(join(packageDir, "dist", "metafile-fake.json"), JSON.stringify(metafile), "utf8");

    const result = checkPackage(packageDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("THIRD-PARTY-NOTICES.txt"))).toBe(true);
  });

  it("passes once writeNoticesFor generates a matching THIRD-PARTY-NOTICES.txt", () => {
    const { packageDir, metafile } = setup();
    metafile.inputs = { "node_modules/good-pkg/index.js": {} };
    mkdirSync(join(packageDir, "dist"), { recursive: true });
    writeFileSync(join(packageDir, "dist", "metafile-fake.json"), JSON.stringify(metafile), "utf8");

    writeNoticesFor(packageDir);
    const result = checkPackage(packageDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
