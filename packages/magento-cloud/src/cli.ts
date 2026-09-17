#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The `hiberus-magento-cloud` CLI adapter (magento-cloud-cli spec). A
// credential is NEVER accepted as a CLI argument — `parseCredentialCliArgs`
// (mcp-core) runs before ANY dispatch, so `--token`/`--token=` is rejected
// before persisting anything. `auth token set` reads the token from stdin
// only. `environment:relationships` is the CLI-only, deliberately
// UNSTRIPPED escape hatch (`getRawRelationshipsText`) — it is never
// reachable from the MCP surface (magento-cloud-mcp spec, "CLI-Only
// Operations Excluded from MCP", proven in `tools/magento-cloud-tools.test.ts`).
// `db:sql` is exposed here too, purely as an operator diagnostic path, going
// through the exact same guarded spec as the MCP tool (`commands.ts`'s
// `dbSqlSpec`) — a guard rejection never spawns a process here either.
import { parseCredentialCliArgs, persistCredential, readTokenFromStdin, redact } from "@hiberus-magento/mcp-core";
import { pathToFileURL } from "node:url";
import { createMagentoCloudAllowlist, ensureBinaryResolved, executeReadOnlyCommand, parseAuthInfo, MagentoCloudCommandFailedError } from "./client/index.js";
import { MAGENTO_CLOUD_DOMAIN, resolveMagentoCloudCredentialDirect } from "./credential-provider.js";

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface CliDeps {
  readonly readStdin: () => Promise<string>;
  readonly persistToken: (token: string) => string;
  /** Throws when no credential can be resolved (env nor file). */
  readonly resolveToken: () => string;
  /** Throws (a "not installed"-shaped error) when the binary cannot be located. */
  readonly locateBin: () => string;
  readonly home: string;
  readonly path: string;
  readonly now: () => number;
}

function renderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Threat matrix (design.md): CLI stderr is surfaced by design and is
  // carried as a JSON/text string field, never interpolated into a
  // command, path, or URL — this CLI never builds a shell command from
  // upstream text. `redact()` still runs before writing to stderr, masking
  // a token-shaped value inside an upstream error.
  return redact(message);
}

function parseFlags(args: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined || !arg.startsWith("--")) {
      continue;
    }
    const eqIndex = arg.indexOf("=");
    if (eqIndex !== -1) {
      flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      continue;
    }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[arg.slice(2)] = next;
      i += 1;
    } else {
      flags[arg.slice(2)] = "true";
    }
  }
  return flags;
}

async function runAuthTokenSet(extra: readonly string[], deps: CliDeps): Promise<CliRunResult> {
  if (extra.length > 0) {
    return {
      exitCode: 1,
      stderr: 'auth token set takes no arguments — pipe the token via stdin instead (e.g. echo "$TOKEN" | hiberus-magento-cloud auth token set).',
    };
  }
  const token = await deps.readStdin();
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return { exitCode: 1, stderr: "auth token set received an empty token on stdin." };
  }
  const path = deps.persistToken(trimmed);
  return { exitCode: 0, stdout: `Token persisted to ${path} (mode 0600).\n` };
}

/**
 * `auth status` is the one command that TOLERATES an absent credential
 * (magento-cloud-mcp spec, Decision 9 — mirrored here for CLI/MCP parity):
 * it wraps `auth:info --no-auto-login` and its entire job is to report
 * whether authentication succeeded, so it needs no token to run. Never
 * echoes the resolved token under any outcome (magento-cloud-cli spec,
 * "Auth Status Never Echoes the Token").
 */
async function runAuthStatus(deps: CliDeps): Promise<CliRunResult> {
  let bin: string;
  try {
    bin = deps.locateBin();
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }

  let token: string | undefined;
  try {
    token = deps.resolveToken();
  } catch {
    token = undefined;
  }

  const allowlist = createMagentoCloudAllowlist(bin);
  const spec = allowlist.resolve(bin, ["auth:info", "--no-auto-login"]);
  if (spec === undefined) {
    return { exitCode: 1, stderr: "internal error: auth:info is not registered on the allowlist." };
  }
  const specWithEnv = { ...spec, env: { HOME: deps.home, PATH: deps.path, ...(token !== undefined ? { MAGENTO_CLOUD_CLI_TOKEN: token } : {}) } };

  try {
    const stdout = await executeReadOnlyCommand({ spec: specWithEnv, rawArgs: {}, now: deps.now });
    const account = parseAuthInfo(stdout);
    return { exitCode: 0, stdout: `${JSON.stringify({ authenticated: true, account })}\n` };
  } catch (error) {
    if (error instanceof MagentoCloudCommandFailedError && error.kind === "not-authenticated") {
      return { exitCode: 1, stdout: `${JSON.stringify({ authenticated: false })}\n`, stderr: renderError(error) };
    }
    return { exitCode: 1, stderr: renderError(error) };
  }
}

/**
 * The CLI-only, deliberately UNSTRIPPED `environment:relationships` display
 * (magento-cloud-cli spec, "Raw environment:relationships Output Is
 * CLI-Only"). `getRawRelationshipsText` is the branded opaque escape hatch —
 * this is the ONLY place it is ever called; no file under `src/tools/**`
 * references it (proven in `client/relationships.test.ts`, re-proven at
 * tasks.md 8.10 once `tools/` exists).
 */
async function runEnvironmentRelationships(flags: Record<string, string>, deps: CliDeps): Promise<CliRunResult> {
  const projectId = flags["project"];
  const environmentId = flags["environment"];
  if (projectId === undefined || environmentId === undefined) {
    return { exitCode: 1, stderr: "environment:relationships requires --project <id> --environment <id>." };
  }

  let bin: string;
  try {
    bin = deps.locateBin();
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }

  let token: string;
  try {
    token = deps.resolveToken();
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }

  const allowlist = createMagentoCloudAllowlist(bin);
  const spec = allowlist.resolve(bin, ["environment:relationships"]);
  if (spec === undefined) {
    return { exitCode: 1, stderr: "internal error: environment:relationships is not registered on the allowlist." };
  }
  const specWithEnv = { ...spec, env: { HOME: deps.home, PATH: deps.path, MAGENTO_CLOUD_CLI_TOKEN: token } };

  try {
    const stdout = await executeReadOnlyCommand({ spec: specWithEnv, rawArgs: { projectId, environmentId }, now: deps.now });
    return { exitCode: 0, stdout };
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }
}

/**
 * `db:sql` as an operator diagnostic — routed through the EXACT SAME
 * guarded spec the MCP tool uses (`commands.ts`'s `dbSqlSpec`, wired as its
 * own `argsSchema.transform()`), so a guard rejection here never spawns a
 * process either (magento-cloud-cli spec, "Exit Codes Reflect Outcome" —
 * "a db:sql guard rejection").
 */
async function runDbSql(flags: Record<string, string>, deps: CliDeps): Promise<CliRunResult> {
  const projectId = flags["project"];
  const environmentId = flags["environment"];
  const query = flags["query"];
  if (projectId === undefined || environmentId === undefined || query === undefined) {
    return { exitCode: 1, stderr: "db:sql requires --project <id> --environment <id> --query <sql>." };
  }

  let bin: string;
  try {
    bin = deps.locateBin();
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }

  let token: string;
  try {
    token = deps.resolveToken();
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }

  const allowlist = createMagentoCloudAllowlist(bin);
  const spec = allowlist.resolve(bin, ["db:sql"]);
  if (spec === undefined) {
    return { exitCode: 1, stderr: "internal error: db:sql is not registered on the allowlist." };
  }
  const specWithEnv = { ...spec, env: { HOME: deps.home, PATH: deps.path, MAGENTO_CLOUD_CLI_TOKEN: token } };

  const rawArgs: Record<string, unknown> = { projectId, environmentId, query };
  if (flags["maxRows"] !== undefined) {
    rawArgs["maxRows"] = Number(flags["maxRows"]);
  }

  try {
    const stdout = await executeReadOnlyCommand({ spec: specWithEnv, rawArgs, now: deps.now });
    return { exitCode: 0, stdout };
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<CliRunResult> {
  const parsed = parseCredentialCliArgs(argv);
  if (!parsed.ok) {
    return { exitCode: 1, stderr: parsed.error.message };
  }

  const [group, sub, action, ...rest] = argv;
  const flags = parseFlags(argv);

  if (group === "auth" && sub === "token" && action === "set") {
    return runAuthTokenSet(rest, deps);
  }
  if (group === "auth" && sub === "status") {
    return runAuthStatus(deps);
  }
  if (group === "environment:relationships") {
    return runEnvironmentRelationships(flags, deps);
  }
  if (group === "db:sql") {
    return runDbSql(flags, deps);
  }

  return { exitCode: 1, stderr: `Unknown command: ${argv.join(" ")}` };
}

/**
 * The process-facing entrypoint (magento-cloud-cli spec, "Exit Codes
 * Reflect Outcome"): runs `runCli` (pure and side-effect-free for
 * testability) and maps its `exitCode` onto `process.exitCode` — never
 * `process.exit()`, which would truncate an in-flight write.
 */
export async function main(argv: readonly string[], deps: CliDeps): Promise<CliRunResult> {
  const result = await runCli(argv, deps);
  process.exitCode = result.exitCode;
  if (result.stdout !== undefined) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr !== undefined) {
    process.stderr.write(`${result.stderr}\n`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Real entrypoint wiring — only runs when this module is the process
// entrypoint, so `cli.test.ts` can import `runCli`/`main` without resolving
// a real credential, a real binary, or reading real stdin (mirrors `aco`'s
// `cli.ts` guard).
// ---------------------------------------------------------------------------
const MAGENTO_CLOUD_BINARY_NAME = "magento-cloud";
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const { homedir } = await import("node:os");
  const rawPath = process.env["PATH"] ?? "";
  const deps: CliDeps = {
    readStdin: readTokenFromStdin,
    persistToken: (token: string) => persistCredential(MAGENTO_CLOUD_DOMAIN, token),
    resolveToken: () => resolveMagentoCloudCredentialDirect(),
    locateBin: () => ensureBinaryResolved({ binaryName: MAGENTO_CLOUD_BINARY_NAME, pathEntries: rawPath.split(":") }),
    home: homedir(),
    path: rawPath,
    now: () => Date.now(),
  };
  await main(process.argv.slice(2), deps);
}
