#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The packaging gate. Run once per package (via `turbo run verify:package`,
// which sets cwd to the package directory) against the package's real build
// output. Asserts that a single-file, dependency-free, `npx`-runnable bundle
// was actually produced — not merely that the source graph looks tree-shaken.
//
// Gates (see design.md, Decision 1):
//   G1  Every `bin` entry the package declares maps to exactly one .js file
//       in dist/, and dist/ contains no .js file beyond those (the defense
//       against code-splitting — NOT "exactly one .js file in dist/ total").
//       A package may legitimately declare more than one bin from one dist/
//       (e.g. a CLI + an MCP server built from the same package); this gate
//       still catches a stray chunk, and still catches a missing bundle.
//   G2  Every declared bin's bundle size <= 2 MB
//   G3  Zero forbidden dependencies survived bundling, across every declared
//       bin's bundle (metafile + text backstop)
//   G4  `npm pack` tarball declares dependencies: {} (or omits the field)
//   G5  Shebang preserved on every declared bin, in the built dist/ bundle
//       AND in the packed tarball
//   G6  LICENSE file present in the tarball
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FORBIDDEN_PACKAGES = [
  "express",
  "hono",
  "@hono/node-server",
  "cors",
  "express-rate-limit",
  "jose",
  "ajv",
  "ajv-formats",
];

export const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
const SHEBANG = "#!/usr/bin/env node";

export class PackagingGateError extends Error {
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

/** Accepts `package.json`'s `bin` field in either shape (a bare string for a single binary, or a name-to-path object) and always returns a flat list of declared paths. */
export function resolveBinPaths(bin) {
  if (typeof bin === "string") {
    return [bin];
  }
  if (bin !== null && bin !== undefined && typeof bin === "object") {
    return Object.values(bin);
  }
  return [];
}

function distRelativeFileName(binPath) {
  const prefix = "dist/";
  if (!binPath.startsWith(prefix)) {
    throw new PackagingGateError("G1", `bin entry "${binPath}" must point inside dist/`);
  }
  return binPath.slice(prefix.length);
}

/**
 * G1's real intent (design.md, Decision 1): one bundled file per declared
 * `bin` entry, with no stray chunk left behind by accidental code-splitting
 * — NOT "exactly one .js file in dist/ total". A package that legitimately
 * declares two binaries from one `dist/` (a CLI and an MCP server built from
 * the same source tree) must still pass this gate; a single-binary package
 * must still behave exactly as before. Returns the list of bundle file
 * names, one per declared bin, for the caller to run G2/G3/G5 against.
 */
export function gateG1SingleBundle(distDir, bin) {
  const jsFiles = findDistJsFiles(distDir);
  const binPaths = resolveBinPaths(bin);
  if (binPaths.length === 0) {
    throw new PackagingGateError("G1", "package.json declares no bin entry to verify dist/ against");
  }

  const expectedFileNames = [];
  for (const binPath of binPaths) {
    const fileName = distRelativeFileName(binPath);
    if (!jsFiles.includes(fileName)) {
      throw new PackagingGateError(
        "G1",
        `declared bin "${binPath}" has no matching bundle in dist/ (found: ${jsFiles.join(", ") || "(none)"})`,
      );
    }
    expectedFileNames.push(fileName);
  }

  const expectedSet = new Set(expectedFileNames);
  const strayFiles = jsFiles.filter((name) => !expectedSet.has(name));
  if (strayFiles.length > 0) {
    throw new PackagingGateError(
      "G1",
      `dist/ contains .js file(s) beyond the declared bin entries: ${strayFiles.join(", ")} (declared: ${expectedFileNames.join(", ")})`,
    );
  }

  return expectedFileNames;
}

export function gateG2BundleSize(bundlePath) {
  const { size } = statSync(bundlePath);
  if (size > MAX_BUNDLE_BYTES) {
    throw new PackagingGateError(
      "G2",
      `bundle is ${size} bytes, exceeds ${MAX_BUNDLE_BYTES} byte limit`,
    );
  }
  return size;
}

function findMetafiles(distDir) {
  const candidates = readdirSync(distDir).filter((name) => name.startsWith("metafile") && name.endsWith(".json"));
  if (candidates.length === 0) {
    throw new PackagingGateError(
      "G3",
      "no tsup metafile found in dist/ — was the package built with metafile: true?",
    );
  }
  return candidates.map((name) => join(distDir, name));
}

function forbiddenInputRegex() {
  const alternation = FORBIDDEN_PACKAGES.map((pkg) => pkg.replace(/[/]/g, "\\/")).join("|");
  return new RegExp(`node_modules/(${alternation})/`);
}

/**
 * `bundlePathOrPaths` accepts either a single bundle path (unchanged
 * behavior for a single-binary package) or an array of bundle paths (a
 * multi-binary package, e.g. eds's `cli.js` + `mcp.js`) — every metafile in
 * `dist/` is merged for the metafile check, and every bundle's text is
 * scanned individually for the backstop check, so a stray forbidden
 * dependency reachable from ANY declared entrypoint still fails the gate.
 */
export function gateG3NoForbiddenModules(distDir, bundlePathOrPaths) {
  const bundlePaths = Array.isArray(bundlePathOrPaths) ? bundlePathOrPaths : [bundlePathOrPaths];
  const metafilePaths = findMetafiles(distDir);
  const regex = forbiddenInputRegex();

  const allInputs = new Set();
  for (const metafilePath of metafilePaths) {
    const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));
    for (const inputPath of Object.keys(metafile.inputs ?? {})) {
      allInputs.add(inputPath);
    }
  }
  const survivors = [...allInputs].filter((inputPath) => regex.test(inputPath));
  if (survivors.length > 0) {
    throw new PackagingGateError(
      "G3",
      `metafile lists forbidden inputs: ${survivors.join(", ")}`,
    );
  }

  // Backstop: grep each bundle's text for esbuild's provenance comments, in
  // case a metafile ever stops reporting truthfully.
  for (const bundlePath of bundlePaths) {
    const bundleText = readFileSync(bundlePath, "utf8");
    const textSurvivors = FORBIDDEN_PACKAGES.filter((pkg) => bundleText.includes(`node_modules/${pkg}/`));
    if (textSurvivors.length > 0) {
      throw new PackagingGateError(
        "G3",
        `bundle text (${bundlePath}) contains provenance comments for forbidden packages: ${textSurvivors.join(", ")}`,
      );
    }
  }
}

export async function gateG5BundleShebang(bundlePath) {
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

export function gateG4TarballDependencies(extractedPackageJsonPath) {
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

export async function gateG5TarballShebang(extractedBundlePath) {
  const head = await readFirstBytes(extractedBundlePath, SHEBANG.length);
  if (!head.startsWith(SHEBANG)) {
    throw new PackagingGateError(
      "G5",
      `"${extractedBundlePath}" does not start with "${SHEBANG}", got: ${JSON.stringify(head)}`,
    );
  }
}

/**
 * G5's tarball half checks the shebang on EVERY declared bin, not just one
 * (the previous implementation only ever checked `Object.values(pkg.bin)[0]`
 * — silently skipping every other declared binary in a multi-bin package).
 */
export async function gateG5AllTarballShebangs(extractedRoot, bin) {
  const binPaths = resolveBinPaths(bin);
  if (binPaths.length === 0) {
    throw new PackagingGateError("G5", "package.json has no bin entry to verify the tarball shebang against");
  }
  for (const binPath of binPaths) {
    await gateG5TarballShebang(join(extractedRoot, binPath));
  }
}

export function gateG6LicenseInTarball(entries) {
  const hasLicense = entries.some((entry) => /(^|\/)LICENSE$/.test(entry.replace(/^package\//, "")));
  if (!hasLicense) {
    throw new PackagingGateError("G6", `tarball is missing a LICENSE file. Entries: ${entries.join(", ")}`);
  }
}

async function main() {
  const packageDir = process.cwd();
  const distDir = join(packageDir, "dist");
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));

  const bundleNames = gateG1SingleBundle(distDir, pkg.bin);
  const bundlePaths = bundleNames.map((name) => join(distDir, name));

  let totalBundleBytes = 0;
  for (const bundlePath of bundlePaths) {
    totalBundleBytes += gateG2BundleSize(bundlePath);
  }
  gateG3NoForbiddenModules(distDir, bundlePaths);
  for (const bundlePath of bundlePaths) {
    await gateG5BundleShebang(bundlePath);
  }

  const workDir = mkdtempSync(join(tmpdir(), "verify-bundle-"));
  try {
    const tarballPath = npmPack(packageDir, workDir);
    const entries = listTarball(tarballPath);
    gateG6LicenseInTarball(entries);

    extractTarball(tarballPath, workDir);
    const extractedRoot = join(workDir, "package");
    gateG4TarballDependencies(join(extractedRoot, "package.json"));
    await gateG5AllTarballShebangs(extractedRoot, pkg.bin);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  console.error(
    `verify-bundle: PASS — ${pkg.name}: ${bundleNames.join(", ")} (${totalBundleBytes} bytes total), zero forbidden dependencies, tarball dependencies: {}, shebang + LICENSE present on every declared bin`,
  );
}

main().catch((error) => {
  console.error(`verify-bundle: FAIL — ${error.message}`);
  process.exitCode = 1;
});
