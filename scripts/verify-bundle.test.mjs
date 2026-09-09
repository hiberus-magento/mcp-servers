// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test closing the sdd-verify CRITICAL findings: `verify-bundle.mjs`
// (mcp-conformance spec, "Published Tarball Shape" and "Bundle Size and
// Forbidden Dependency Gate") had zero exported functions and zero dedicated
// test file, unlike every sibling gate script (`check-licenses.mjs`,
// `scan-secrets.mjs`, `gen-readme.mjs`, `validate-manifest.mjs`), which all
// export their core logic and unit-test both the pass and the fail path.
// This file follows that exact established pattern.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FORBIDDEN_PACKAGES,
  MAX_BUNDLE_BYTES,
  PackagingGateError,
  gateG1SingleBundle,
  gateG2BundleSize,
  gateG3NoForbiddenModules,
  gateG4TarballDependencies,
  gateG5BundleShebang,
  gateG5TarballShebang,
  gateG6LicenseInTarball,
} from "./verify-bundle.mjs";

let workDir;

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  }
});

function tempDistDir() {
  workDir = mkdtempSync(join(tmpdir(), "verify-bundle-test-"));
  const distDir = join(workDir, "dist");
  mkdirSync(distDir, { recursive: true });
  return distDir;
}

describe("gateG1SingleBundle", () => {
  it("passes and returns the sole .js file when exactly one exists", () => {
    const distDir = tempDistDir();
    writeFileSync(join(distDir, "server.js"), "console.log('hi');", "utf8");

    expect(gateG1SingleBundle(distDir)).toBe("server.js");
  });

  it("fails when dist/ contains zero .js files", () => {
    const distDir = tempDistDir();
    writeFileSync(join(distDir, "server.txt"), "not js", "utf8");

    expect(() => gateG1SingleBundle(distDir)).toThrow(PackagingGateError);
    try {
      gateG1SingleBundle(distDir);
    } catch (error) {
      expect(error.gate).toBe("G1");
      expect(error.message).toMatch(/found 0/);
    }
  });

  it("fails when dist/ contains more than one .js file", () => {
    const distDir = tempDistDir();
    writeFileSync(join(distDir, "server.js"), "1", "utf8");
    writeFileSync(join(distDir, "extra.js"), "2", "utf8");

    expect(() => gateG1SingleBundle(distDir)).toThrow(PackagingGateError);
    try {
      gateG1SingleBundle(distDir);
    } catch (error) {
      expect(error.gate).toBe("G1");
      expect(error.message).toMatch(/found 2/);
    }
  });
});

describe("gateG2BundleSize", () => {
  it("passes for a bundle under the 2 MB ceiling", () => {
    const distDir = tempDistDir();
    const bundlePath = join(distDir, "server.js");
    writeFileSync(bundlePath, "console.log('small');", "utf8");

    expect(gateG2BundleSize(bundlePath)).toBeLessThan(MAX_BUNDLE_BYTES);
  });

  it("fails when the bundle exceeds the 2 MB size ceiling", () => {
    const distDir = tempDistDir();
    const bundlePath = join(distDir, "server.js");
    writeFileSync(bundlePath, Buffer.alloc(MAX_BUNDLE_BYTES + 1, "a"));

    expect(() => gateG2BundleSize(bundlePath)).toThrow(PackagingGateError);
    try {
      gateG2BundleSize(bundlePath);
    } catch (error) {
      expect(error.gate).toBe("G2");
      expect(error.message).toMatch(/exceeds/);
    }
  });
});

function writeMetafile(distDir, inputs) {
  writeFileSync(join(distDir, "metafile-server.json"), JSON.stringify({ inputs }), "utf8");
}

describe("gateG3NoForbiddenModules", () => {
  it("passes when the metafile and bundle text contain no forbidden dependency", () => {
    const distDir = tempDistDir();
    writeMetafile(distDir, { "src/index.ts": {}, "node_modules/zod/index.js": {} });
    const bundlePath = join(distDir, "server.js");
    writeFileSync(bundlePath, "// bundled code, no forbidden markers", "utf8");

    expect(() => gateG3NoForbiddenModules(distDir, bundlePath)).not.toThrow();
  });

  it(`fails when the metafile lists a forbidden dependency (e.g. "${FORBIDDEN_PACKAGES[0]}")`, () => {
    const distDir = tempDistDir();
    writeMetafile(distDir, { [`node_modules/${FORBIDDEN_PACKAGES[0]}/index.js`]: {} });
    const bundlePath = join(distDir, "server.js");
    writeFileSync(bundlePath, "// clean bundle text", "utf8");

    expect(() => gateG3NoForbiddenModules(distDir, bundlePath)).toThrow(PackagingGateError);
    try {
      gateG3NoForbiddenModules(distDir, bundlePath);
    } catch (error) {
      expect(error.gate).toBe("G3");
      expect(error.message).toContain(FORBIDDEN_PACKAGES[0]);
    }
  });

  it("fails via the text backstop when the bundle text carries a forbidden provenance comment even if the metafile is clean", () => {
    const distDir = tempDistDir();
    writeMetafile(distDir, { "src/index.ts": {} });
    const bundlePath = join(distDir, "server.js");
    writeFileSync(bundlePath, `// node_modules/${FORBIDDEN_PACKAGES[0]}/index.js\nconsole.log(1);`, "utf8");

    expect(() => gateG3NoForbiddenModules(distDir, bundlePath)).toThrow(PackagingGateError);
    try {
      gateG3NoForbiddenModules(distDir, bundlePath);
    } catch (error) {
      expect(error.gate).toBe("G3");
      expect(error.message).toMatch(/provenance comments/);
    }
  });
});

describe("gateG4TarballDependencies", () => {
  it("passes when dependencies is absent from the extracted package.json", () => {
    workDir = mkdtempSync(join(tmpdir(), "verify-bundle-test-"));
    const pkgPath = join(workDir, "package.json");
    writeFileSync(pkgPath, JSON.stringify({ name: "pkg" }), "utf8");

    expect(() => gateG4TarballDependencies(pkgPath)).not.toThrow();
  });

  it("passes when dependencies is an empty object", () => {
    workDir = mkdtempSync(join(tmpdir(), "verify-bundle-test-"));
    const pkgPath = join(workDir, "package.json");
    writeFileSync(pkgPath, JSON.stringify({ name: "pkg", dependencies: {} }), "utf8");

    expect(() => gateG4TarballDependencies(pkgPath)).not.toThrow();
  });

  it("fails and names the surviving dependency when the tarball declares one", () => {
    workDir = mkdtempSync(join(tmpdir(), "verify-bundle-test-"));
    const pkgPath = join(workDir, "package.json");
    writeFileSync(pkgPath, JSON.stringify({ name: "pkg", dependencies: { express: "^4.0.0" } }), "utf8");

    expect(() => gateG4TarballDependencies(pkgPath)).toThrow(PackagingGateError);
    try {
      gateG4TarballDependencies(pkgPath);
    } catch (error) {
      expect(error.gate).toBe("G4");
      expect(error.message).toContain("express");
    }
  });
});

describe("gateG5BundleShebang / gateG5TarballShebang", () => {
  it("passes when the bundle starts with the required shebang", async () => {
    workDir = mkdtempSync(join(tmpdir(), "verify-bundle-test-"));
    const bundlePath = join(workDir, "server.js");
    writeFileSync(bundlePath, "#!/usr/bin/env node\nconsole.log(1);", "utf8");

    await expect(gateG5BundleShebang(bundlePath)).resolves.toBeUndefined();
    await expect(gateG5TarballShebang(bundlePath)).resolves.toBeUndefined();
  });

  it("fails when the bundle is missing the shebang", async () => {
    workDir = mkdtempSync(join(tmpdir(), "verify-bundle-test-"));
    const bundlePath = join(workDir, "server.js");
    writeFileSync(bundlePath, "console.log('no shebang');", "utf8");

    await expect(gateG5BundleShebang(bundlePath)).rejects.toThrow(PackagingGateError);
  });
});

describe("gateG6LicenseInTarball", () => {
  it("passes when the entry list includes a top-level LICENSE file", () => {
    expect(() => gateG6LicenseInTarball(["package/server.js", "package/LICENSE", "package/package.json"])).not.toThrow();
  });

  it("fails when the tarball has no LICENSE file", () => {
    const entries = ["package/server.js", "package/package.json"];

    expect(() => gateG6LicenseInTarball(entries)).toThrow(PackagingGateError);
    try {
      gateG6LicenseInTarball(entries);
    } catch (error) {
      expect(error.gate).toBe("G6");
      expect(error.message).toMatch(/missing a LICENSE file/);
    }
  });
});
