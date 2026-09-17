// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Pre-spawn and post-spawn CLI-failure classification (design.md, Decision
// 2; magento-cloud-client spec, "CLI-Failure Classification Names an
// Actionable Remedy"; tasks.md 2.4, 2.6-2.10).
import { MagentoCloudNotAuthenticatedError, MagentoCloudNotInstalledError } from "./errors.js";
import { locateBinary } from "./locate-binary.js";

// PROVISIONAL (design.md Open Questions; tasks.md 2.10): exploration found
// a `VERSION = '5.3.1'` constant inside the installed binary but could not
// confirm it was the CLI's own version rather than a bundled dependency's,
// since `--version` was never executed during that pass. During THIS
// batch's apply, `magento-cloud --version` was run for real against the
// installed CLI and printed "Magento Cloud CLI 1.47.0" — a different
// format AND a different value than the 5.3.1 guess, confirming that guess
// was NOT the CLI's own version. The only version this package has been
// run against is 1.47.0, so that is the floor recorded here; a lower
// version is UNCONFIRMED, not proven broken. This check is warn-only
// end-to-end (Decision 2): `resolveCliVersionInfo`'s `supported` flag is
// advisory, and this module never throws `MagentoCloudUnsupportedVersionError`
// on its own — a future caller decides whether/how to surface
// `supported: false`.
export const MINIMUM_SUPPORTED_CLI_VERSION = "1.47.0";

/**
 * Resolves the `magento-cloud` binary before any process is spawned,
 * throwing `MagentoCloudNotInstalledError` when it cannot be found — this
 * is what makes `mcp-core`'s `run-allowlisted.ts:43` `ENOENT` trap
 * unreachable: with no binary resolved, `execFile`/`runAllowlisted` is
 * never called at all.
 */
export function ensureBinaryResolved(options: { readonly binaryName: string; readonly pathEntries: readonly string[] }): string {
  const resolved = locateBinary(options);
  if (resolved === undefined) {
    throw new MagentoCloudNotInstalledError(options.binaryName);
  }
  return resolved;
}

export type ClassifiedCliFailure =
  | { readonly kind: "not-authenticated"; readonly message: string }
  | { readonly kind: "generic"; readonly exitCode: number; readonly message: string };

// The CLI's own real, verified non-interactive login-required text
// (exploration.md, "Authentication" section — read directly from
// `Api::getOauth2Plugin()`'s `LoginRequiredException` message and
// `Symfony\Console\Input::isInteractive()`'s non-interactive fallback).
// Matching on either substring keeps this resilient to which exact
// sentence the CLI leads with.
const NOT_AUTHENTICATED_MARKERS = ["Not logged in", "authenticate non-interactively"] as const;

export function classifyCliFailure(input: { readonly exitCode: number; readonly stderr: string }): ClassifiedCliFailure {
  const looksNotAuthenticated = input.exitCode !== 0 && NOT_AUTHENTICATED_MARKERS.some((marker) => input.stderr.includes(marker));
  if (looksNotAuthenticated) {
    return { kind: "not-authenticated", message: new MagentoCloudNotAuthenticatedError("MAGENTO_CLOUD_CLI_TOKEN").message };
  }
  return {
    kind: "generic",
    exitCode: input.exitCode,
    message: input.stderr.length > 0 ? input.stderr : `magento-cloud exited with code ${input.exitCode}`,
  };
}

export interface CliVersionInfo {
  readonly raw: string;
  readonly parsed: string;
  readonly supported: boolean;
}

/** An unparseable `--version` output does NOT fail — it records "unknown"
 * and callers proceed. Refusing to run because a version string could not
 * be parsed would be a worse failure than running (design.md, Decision 2). */
export function parseCliVersion(rawOutput: string): string {
  const match = /(\d+\.\d+\.\d+)/.exec(rawOutput);
  return match?.[1] ?? "unknown";
}

function versionParts(version: string): readonly [number, number, number] {
  const [major, minor, patch] = version.split(".").map(Number);
  return [major ?? 0, minor ?? 0, patch ?? 0];
}

function isAtLeast(version: string, minimum: string): boolean {
  const [vMajor, vMinor, vPatch] = versionParts(version);
  const [mMajor, mMinor, mPatch] = versionParts(minimum);
  if (vMajor !== mMajor) {
    return vMajor > mMajor;
  }
  if (vMinor !== mMinor) {
    return vMinor > mMinor;
  }
  return vPatch >= mPatch;
}

// Parsed once per process, then memoized — a `--version` spawn is real
// process overhead, not something to repeat on every call (design.md,
// Decision 2 table: "parsed once per process, memoized").
let cachedVersionInfo: CliVersionInfo | undefined;

export function resolveCliVersionInfo(rawVersionOutput: string): CliVersionInfo {
  if (cachedVersionInfo !== undefined) {
    return cachedVersionInfo;
  }
  const parsed = parseCliVersion(rawVersionOutput);
  const supported = parsed === "unknown" ? true : isAtLeast(parsed, MINIMUM_SUPPORTED_CLI_VERSION);
  cachedVersionInfo = { raw: rawVersionOutput, parsed, supported };
  return cachedVersionInfo;
}

/** Test-only: resets the per-process memo so each test case starts clean. */
export function resetCliVersionMemoForTests(): void {
  cachedVersionInfo = undefined;
}
