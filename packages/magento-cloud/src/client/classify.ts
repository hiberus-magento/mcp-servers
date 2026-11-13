// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Pre-spawn and post-spawn CLI-failure classification (design.md, Decision
// 2; magento-cloud-client spec, "CLI-Failure Classification Names an
// Actionable Remedy"; tasks.md 2.4, 2.6-2.10).
import { MagentoCloudNotAuthenticatedError, MagentoCloudNotInstalledError, MagentoCloudOutputCapError } from "./errors.js";
import { locateBinary } from "./locate-binary.js";
import { DB_RELATIONSHIP_PATTERN } from "./commands.js";

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

// db:size / db:sql target selection. Read from the installed CLI 1.47.0's
// own source (`Relationships::chooseDatabase`, `CommandBase::selectApp`):
// with no TTY it cannot ask which relationship or application to use, so it
// prints one of these on stderr and exits non-zero. The relationship refusal
// is followed by the offered names, one per indented line — names only,
// never the `user@host` labels the interactive chooser shows.
const RELATIONSHIP_REQUIRED_MARKER = "More than one relationship found";
const RELATIONSHIP_NOT_FOUND_PATTERN = /Relationship not found:\s*(\S+)/;
const APP_REQUIRED_MARKER = "Specifying the --app";
const READ_REPLICA_HINT_PATTERN = /slave|replica/;

function offeredRelationshipNames(stderr: string): readonly string[] {
  const optionsIndex = stderr.indexOf("Options:");
  if (optionsIndex === -1) {
    return [];
  }
  // Only lines that are themselves valid relationship names are echoed back:
  // the hint must never relay arbitrary upstream text as if it were a name.
  return stderr
    .slice(optionsIndex + "Options:".length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => DB_RELATIONSHIP_PATTERN.test(line));
}

/** How the remedy names the two inputs: tool fields by default, flags for the operator CLI. */
export interface DbTargetInputNames {
  readonly relationship: string;
  readonly app: string;
}

const TOOL_INPUT_NAMES: DbTargetInputNames = { relationship: '"relationship"', app: '"app"' };

/**
 * Turns the CLI's non-interactive relationship/app refusal into a remedy that
 * names the input to set, listing the relationship names the CLI itself
 * offered. Returns `undefined` for any other failure, so the caller keeps the
 * CLI's own words. Pure: string in, string out — no second CLI call.
 */
export function describeDbTargetSelectionFailure(stderr: string, inputNames: DbTargetInputNames = TOOL_INPUT_NAMES): string | undefined {
  const { relationship: relationshipInput, app: appInput } = inputNames;
  if (stderr.includes(RELATIONSHIP_REQUIRED_MARKER)) {
    const names = offeredRelationshipNames(stderr);
    const replica = names.find((name) => READ_REPLICA_HINT_PATTERN.test(name));
    return (
      "This environment has more than one database relationship and the Magento Cloud CLI cannot choose one non-interactively. " +
      (names.length > 0
        ? `Retry with ${relationshipInput} set to one of: ${names.join(", ")}.`
        : `Retry with ${relationshipInput} set to the relationship to query.`) +
      (replica !== undefined ? ` For diagnostics, prefer the read replica "${replica}" to keep load off the primary.` : "")
    );
  }
  const notFound = RELATIONSHIP_NOT_FOUND_PATTERN.exec(stderr);
  if (notFound !== null) {
    const name = notFound[1] ?? "";
    const shown = DB_RELATIONSHIP_PATTERN.test(name) ? ` "${name}"` : "";
    return `The requested relationship${shown} does not exist on this environment. Retry with ${relationshipInput} set to an existing relationship name, or omit it.`;
  }
  if (stderr.includes(APP_REQUIRED_MARKER)) {
    return `This environment runs more than one application and the Magento Cloud CLI cannot choose one non-interactively. Retry with ${appInput} set to the application name.`;
  }
  return undefined;
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

// design.md, Decision 6, as WRITTEN: `CommandResult.timedOut` is `killed
// && signal === "SIGKILL"`, and Node was assumed to use that SAME
// `killSignal` for a `maxBuffer` overflow, making the two causes
// indistinguishable through `timedOut` alone.
//
// VERIFIED CORRECTION (real spawn against the checked-in fake binary, Node
// v22.14.0 — see `classify.timeout.test.ts`): that assumption is FALSE.
// `execFile`'s `maxBuffer` overflow does NOT set `error.killed`/
// `error.signal` at all, so `run-allowlisted.ts`'s `timedOut` computation
// stays `false` for a byte-cap kill, and `error.code` is the STRING
// `"ERR_CHILD_PROCESS_STDIO_MAXBUFFER"` — `typeof error.code === "number"
// ? error.code : 1` collapses it to a generic `exitCode: 1`. A caller MUST
// therefore invoke `classifyKill` whenever `exitCode !== 0` (not only when
// `timedOut === true`) to catch a byte-cap kill; `stdout`/`stderr` length
// against `maxOutputBytes` is still what actually decides it, disambiguated
// with an INJECTED clock (never `Date.now()` read directly), so ambiguity
// is REPORTED, never guessed.
export type KillClassification =
  | { readonly kind: "output-cap-exceeded"; readonly message: string }
  | { readonly kind: "timed-out"; readonly message: string }
  | { readonly kind: "resource-limit-exceeded"; readonly message: string }
  | { readonly kind: "killed-unclassified"; readonly message: string };

export interface ClassifyKillInput {
  /** Elapsed wall-clock time around the spawn, injected by the caller —
   * never read from `Date.now()` inside this pure function. */
  readonly elapsedMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

// CHOSEN, not derived (design.md, Decision 6): elapsed time is measured
// around the whole spawn promise and therefore includes process-startup
// overhead, so a byte-cap kill arriving at, say, 0.95x the time budget
// would otherwise be misattributed as a timeout too. 0.9 leaves headroom
// for that overhead while still catching a genuine near-deadline kill.
export const TIME_ATTRIBUTION_FACTOR = 0.9;

// `maxBuffer` applies to stdout and stderr SEPARATELY (design.md, Decision
// 6) — a large stderr alone can trip the cap even with tiny stdout, so the
// two are measured independently and the larger one decides. Byte length,
// not `.length`: a multi-byte UTF-8 character split across the buffer
// boundary would otherwise under-count.
function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

// A 4-byte tolerance below the configured cap covers exactly one split
// multi-byte UTF-8 sequence landing at the buffer boundary.
const BYTE_CAP_TOLERANCE_BYTES = 4;

export function classifyKill(input: ClassifyKillInput): KillClassification {
  const atByteCap =
    Math.max(byteLength(input.stdout), byteLength(input.stderr)) >= input.maxOutputBytes - BYTE_CAP_TOLERANCE_BYTES;
  const atTimeBudget = input.elapsedMs >= input.timeoutMs * TIME_ATTRIBUTION_FACTOR;

  const outputCapMessage = new MagentoCloudOutputCapError({ maxOutputBytes: input.maxOutputBytes }).message;
  const timeBudgetMessage = `The call reached its ${input.timeoutMs}ms time budget and was terminated. Narrow the WHERE clause or split the query and retry.`;

  if (atByteCap && atTimeBudget) {
    // Asserting either cause alone would be asserting a WRONG cause half
    // the time — name both, per design.md's explicit instruction.
    return {
      kind: "resource-limit-exceeded",
      message: `The call was terminated and BOTH the output cap and the time budget were at their limit, so the exact cause cannot be attributed with confidence. ${outputCapMessage} ${timeBudgetMessage}`,
    };
  }
  if (atByteCap) {
    return { kind: "output-cap-exceeded", message: outputCapMessage };
  }
  if (atTimeBudget) {
    return { kind: "timed-out", message: timeBudgetMessage };
  }
  return {
    kind: "killed-unclassified",
    message: `The call was terminated but neither the output cap nor the time budget appears to have been reached; the cause could not be attributed. ${outputCapMessage} ${timeBudgetMessage}`,
  };
}
