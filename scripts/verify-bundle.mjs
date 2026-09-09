#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The packaging gate. Run once per package (via `turbo run verify:package`,
// which sets cwd to the package directory) against the package's real build
// output. Asserts that a single-file, dependency-free, `npx`-runnable bundle
// was actually produced — not merely that the source graph looks tree-shaken.
//
// Gates (see design.md, Decision 1):
//   G1  Exactly one .js file in dist/
//   G2  Bundle size <= 2 MB
//   G3  Zero forbidden dependencies survived bundling (metafile + text backstop)
//   G4  `npm pack` tarball declares dependencies: {} (or omits the field)
//   G5  Shebang preserved on both the bundle and the tarball entry
//   G6  LICENSE file present in the tarball
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FORBIDDEN_PACKAGES = [
  "express",
  "hono",
  "@hono/node-server",
  "cors",
  "express-rate-limit",
  "jose",
  "ajv",
  "ajv-formats",
];

const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
const SHEBANG = "#!/usr/bin/env node";

class PackagingGateError extends Error {
  constructor(gate, message) {
    super(`[${gate}] ${message}`);
    this.name = "PackagingGateError";
    this.gate = gate;
  }
}

function readFirstBytes(path, length) {
  const fd = createReadStream(path, { start: 0, end: length - 1 });
  return new Promise((resolve, reject) => {
    const chunks = [];
    fd.on("data", (chunk) => chunks.push(chunk));
    fd.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    fd.on("error", reject);
  });
}

function findDistJsFiles(distDir) {
  return readdirSync(distDir).filter((name) => name.endsWith(".js"));
}

function gateG1SingleBundle(distDir) {
  const jsFiles = findDistJsFiles(distDir);
  if (jsFiles.length !== 1) {
    throw new PackagingGateError(
      "G1",
      `expected exactly one .js file in dist/, found ${jsFiles.length}: ${jsFiles.join(", ") || "(none)"}`,
    );
  }
  return jsFiles[0];
}

function gateG2BundleSize(bundlePath) {
  const { size } = statSync(bundlePath);
  if (size > MAX_BUNDLE_BYTES) {
    throw new PackagingGateError(
      "G2",
      `bundle is ${size} bytes, exceeds ${MAX_BUNDLE_BYTES} byte limit`,
    );
  }
  return size;
}

function findMetafile(distDir) {
  const candidates = readdirSync(distDir).filter((name) => name.startsWith("metafile") && name.endsWith(".json"));
  if (candidates.length === 0) {
    throw new PackagingGateError(
      "G3",
      "no tsup metafile found in dist/ — was the package built with metafile: true?",
    );
  }
  return join(distDir, candidates[0]);
}

function forbiddenInputRegex() {
  const alternation = FORBIDDEN_PACKAGES.map((pkg) => pkg.replace(/[/]/g, "\\/")).join("|");
  return new RegExp(`node_modules/(${alternation})/`);
}

function gateG3NoForbiddenModules(distDir, bundlePath) {
  const metafilePath = findMetafile(distDir);
  const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));
  const regex = forbiddenInputRegex();
  const survivors = Object.keys(metafile.inputs ?? {}).filter((inputPath) => regex.test(inputPath));
  if (survivors.length > 0) {
    throw new PackagingGateError(
      "G3",
      `metafile lists forbidden inputs: ${survivors.join(", ")}`,
    );
  }

  // Backstop: grep the bundle text for esbuild's provenance comments, in case
  // the metafile ever stops reporting truthfully.
  const bundleText = readFileSync(bundlePath, "utf8");
  const textSurvivors = FORBIDDEN_PACKAGES.filter((pkg) => bundleText.includes(`node_modules/${pkg}/`));
  if (textSurvivors.length > 0) {
    throw new PackagingGateError(
      "G3",
      `bundle text contains provenance comments for forbidden packages: ${textSurvivors.join(", ")}`,
    );
  }
}

async function gateG5BundleShebang(bundlePath) {
  const head = await readFirstBytes(bundlePath, SHEBANG.length);
  if (!head.startsWith(SHEBANG)) {
    throw new PackagingGateError("G5", `bundle does not start with "${SHEBANG}", got: ${JSON.stringify(head)}`);
  }
}

function npmPack(packageDir, destDir) {
  const output = execFileSync("npm", ["pack", "--json", "--pack-destination", destDir], {
    cwd: packageDir,
    encoding: "utf8",
  });
  const [result] = JSON.parse(output);
  return join(destDir, result.filename);
}

function extractTarball(tarballPath, destDir) {
  execFileSync("tar", ["-xf", tarballPath, "-C", destDir]);
}

function listTarball(tarballPath) {
  return execFileSync("tar", ["-tf", tarballPath], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function gateG4TarballDependencies(extractedPackageJsonPath) {
  const pkg = JSON.parse(readFileSync(extractedPackageJsonPath, "utf8"));
  const deps = pkg.dependencies;
  const isEmpty = deps === undefined || Object.keys(deps).length === 0;
  if (!isEmpty) {
    throw new PackagingGateError(
      "G4",
      `tarball package.json declares non-empty dependencies: ${JSON.stringify(deps)}`,
    );
  }
}

async function gateG5TarballShebang(extractedBundlePath) {
  const head = await readFirstBytes(extractedBundlePath, SHEBANG.length);
  if (!head.startsWith(SHEBANG)) {
    throw new PackagingGateError(
      "G5",
      `tarball bundle does not start with "${SHEBANG}", got: ${JSON.stringify(head)}`,
    );
  }
}

function gateG6LicenseInTarball(entries) {
  const hasLicense = entries.some((entry) => /(^|\/)LICENSE$/.test(entry.replace(/^package\//, "")));
  if (!hasLicense) {
    throw new PackagingGateError("G6", `tarball is missing a LICENSE file. Entries: ${entries.join(", ")}`);
  }
}

async function main() {
  const packageDir = process.cwd();
  const distDir = join(packageDir, "dist");
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));

  const bundleName = gateG1SingleBundle(distDir);
  const bundlePath = join(distDir, bundleName);
  const bundleSize = gateG2BundleSize(bundlePath);
  gateG3NoForbiddenModules(distDir, bundlePath);
  await gateG5BundleShebang(bundlePath);

  const workDir = mkdtempSync(join(tmpdir(), "verify-bundle-"));
  try {
    const tarballPath = npmPack(packageDir, workDir);
    const entries = listTarball(tarballPath);
    gateG6LicenseInTarball(entries);

    extractTarball(tarballPath, workDir);
    const extractedRoot = join(workDir, "package");
    gateG4TarballDependencies(join(extractedRoot, "package.json"));

    const binEntry = typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin ?? {})[0];
    if (!binEntry) {
      throw new PackagingGateError("G5", "package.json has no bin entry to verify the tarball shebang against");
    }
    await gateG5TarballShebang(join(extractedRoot, binEntry));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  console.error(
    `verify-bundle: PASS — ${pkg.name}: ${bundleName} (${bundleSize} bytes), zero forbidden dependencies, tarball dependencies: {}, shebang + LICENSE present`,
  );
}

main().catch((error) => {
  console.error(`verify-bundle: FAIL — ${error.message}`);
  process.exitCode = 1;
});
