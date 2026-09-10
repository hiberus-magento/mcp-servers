#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The `hiberus-eds` CLI adapter (design.md, Decision 6; eds-cli spec).
// `runCli` handles exactly the `auth token set` / `auth mint` / `auth
// status` subcommands; every operation on the CLI-only exclusion list
// (`site apply`, `key create`, `code show`, etc. — eds-cli spec, "CLI-Only
// Operations Excluded from MCP") has NO implementation in this change and
// falls through to `runCli`'s "Unknown command" response — implementing
// them is out of scope (proposal.md, "Out of Scope").
//
// A token is NEVER accepted as a CLI argument. `parseCredentialCliArgs`
// (mcp-core) runs before ANY dispatch, so `--token`/`--token=` is rejected
// before persisting anything. `auth token set` additionally rejects any
// extra positional argument — its handler (`setToken`) has no parameter to
// receive one at all, so a positional token would have nowhere to go even
// if this check were removed (design.md, Decision 6, layers 1–2).
import { parseCredentialCliArgs, persistCredential, readTokenFromStdin, redact } from "@hiberus-magento/mcp-core";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createEdsClient, type EdsClient } from "./client/index.js";
import { EDS_DOMAIN, createEdsTokenProvider, resolveEdsCredentialDirect } from "./credential-provider.js";

export interface OptionSpec {
  readonly name: string;
  readonly description: string;
}

/** No option here may ever carry a credential value — proven by cli.test.ts. */
export const CLI_OPTIONS: readonly OptionSpec[] = [
  { name: "--site", description: "Target site for auth mint/status." },
  { name: "--roles", description: "Comma-separated roles for the minted key (auth mint)." },
  { name: "--persist", description: "Persist a minted key immediately — overwrites the stored key (auth mint)." },
];

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface SetTokenDeps {
  readonly readStdin: () => Promise<string>;
  readonly persist: (token: string) => string;
  readonly configDir?: string | undefined;
}

function assertNoLoosePermissions(configDir?: string): void {
  try {
    resolveEdsCredentialDirect(configDir);
  } catch (error) {
    // A loose-permission file must surface verbatim; a missing credential
    // (the expected first-run state) is not an error here at all.
    if (error instanceof Error && error.name === "LooseCredentialFilePermissionsError") {
      throw error;
    }
  }
}

/** No token parameter — wiring one from argv would require a NEW function, not a new call site. */
export async function setToken(deps: SetTokenDeps): Promise<CliRunResult> {
  try {
    assertNoLoosePermissions(deps.configDir);
  } catch (error) {
    return { exitCode: 1, stderr: (error as Error).message };
  }
  const token = await deps.readStdin();
  const path = deps.persist(token);
  return { exitCode: 0, stderr: `Token persisted to ${path} (mode 0600).` };
}

// Verified against the Admin Service API reference at
// https://www.aem.live/docs/admin.html: the OrgConfig schema's `roles`
// property declares this exact enum, and the same set applies to both
// org-scoped and site-scoped key creation. This closes design.md's Open
// Question 3, which had left the list narrowed to the two roles the
// bootstrap example happened to show.
//
// Ordered from most to least privileged, so a reader sees the blast radius
// before the convenience.
const CONFIRMED_ROLES = [
  "admin",
  "config_admin",
  "config",
  "develop",
  "author",
  "publish",
  "basic_author",
  "basic_publish",
] as const;
const rolesSchema = z.array(z.enum(CONFIRMED_ROLES)).min(1);

function parseRoles(raw: string): { readonly ok: true; readonly roles: string[] } | { readonly ok: false; readonly message: string } {
  const candidates = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const parsed = rolesSchema.safeParse(candidates);
  if (!parsed.success) {
    const confirmedSet = new Set<string>(CONFIRMED_ROLES);
    const invalid = candidates.filter((c) => !confirmedSet.has(c));
    return {
      ok: false,
      message: `Unsupported role(s): ${invalid.join(", ")}. Confirmed roles are: ${CONFIRMED_ROLES.join(", ")}.`,
    };
  }
  return { ok: true, roles: parsed.data };
}

export interface CliDeps extends SetTokenDeps {
  readonly client: EdsClient;
  readonly org: string;
  readonly site?: string | undefined;
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

async function runAuthMint(args: readonly string[], deps: CliDeps): Promise<CliRunResult> {
  const flags = parseFlags(args);
  const site = flags.site ?? deps.site;
  if (site === undefined) {
    return { exitCode: 1, stderr: "auth mint requires --site <site>." };
  }
  const rolesResult = parseRoles(flags.roles ?? "");
  if (!rolesResult.ok) {
    return { exitCode: 1, stderr: rolesResult.message };
  }

  const minted = await deps.client.auth.mintApiKey({ org: deps.org, site, roles: rolesResult.roles });

  const stdout = `${minted.value}\n`;
  const bannerLines = [
    "This value is shown once and cannot be retrieved again. Store it now.",
    `id: ${minted.id}`,
    `roles: ${minted.roles.join(", ")}`,
    `expiresAt: ${minted.expiresAt}`,
  ];

  if (flags.persist === "true") {
    const path = deps.persist(minted.value);
    bannerLines.push(`Persisted to ${path}.`);
  } else {
    bannerLines.push('Next: echo "<value>" | hiberus-eds auth token set');
  }

  return { exitCode: 0, stdout, stderr: bannerLines.join("\n") };
}

async function runAuthStatus(deps: CliDeps): Promise<CliRunResult> {
  let token: string;
  try {
    token = resolveEdsCredentialDirect(deps.configDir);
  } catch (error) {
    // Surfaces LooseCredentialFilePermissionsError (or MissingCredentialError)
    // verbatim — bypassing StaticTokenProvider's catch-and-rewrap
    // (design.md, Decision 6's documented wart mitigation).
    return { exitCode: 1, stderr: redact((error as Error).message) };
  }

  const statusOptions = deps.site !== undefined ? { org: deps.org, site: deps.site } : { org: deps.org };
  const status = await deps.client.auth.authStatus(statusOptions);
  const fingerprint = createHash("sha256").update(token).digest("hex").slice(0, 8);
  const lines = [`key fingerprint: ${fingerprint}`, ...status.probes.map((p) => `${p.path}: HTTP ${p.status} (${p.verdict})`)];
  const anyReachable = status.probes.some((p) => p.verdict === "reachable");
  return { exitCode: anyReachable ? 0 : 1, stdout: redact(lines.join("\n")) };
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<CliRunResult> {
  const parsed = parseCredentialCliArgs(argv);
  if (!parsed.ok) {
    return { exitCode: 1, stderr: parsed.error.message };
  }

  const [group, sub, action, ...extra] = argv;

  if (group === "auth" && sub === "token" && action === "set") {
    if (extra.length > 0) {
      return {
        exitCode: 1,
        stderr:
          'auth token set takes no arguments — pipe the token via stdin instead (e.g. echo "$TOKEN" | hiberus-eds auth token set).',
      };
    }
    return setToken(deps);
  }
  if (group === "auth" && sub === "mint") {
    return runAuthMint(argv.slice(2), deps);
  }
  if (group === "auth" && sub === "status") {
    return runAuthStatus(deps);
  }

  return { exitCode: 1, stderr: `Unknown command: ${argv.join(" ")}` };
}

/**
 * The process-facing entrypoint (eds-cli spec, "Exit Codes Reflect
 * Outcome"): runs `runCli` (kept pure and side-effect-free for testability)
 * and maps its `exitCode` onto `process.exitCode` — never `process.exit()`,
 * which would truncate any still-in-flight stdout/stderr write. Also writes
 * `result.stdout`/`result.stderr` to the real streams, since `runCli` itself
 * never writes anywhere (it only returns what to write).
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
// entrypoint, so `cli.test.ts` can import `runCli`/`setToken`/`main` without
// resolving a real credential or reading real stdin (mirrors `mcp.ts`'s
// `isDirectRun` guard).
// ---------------------------------------------------------------------------

const BASE_URL = "https://admin.hlx.page";
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const org = process.env.EDS_ORG;
  if (org === undefined || org.length === 0) {
    process.stderr.write("hiberus-eds: the EDS_ORG environment variable is required.\n");
    process.exitCode = 1;
  } else {
    const client = createEdsClient({
      fetch: globalThis.fetch,
      now: () => Date.now(),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      tokenProvider: createEdsTokenProvider(),
      baseUrl: BASE_URL,
      org,
    });
    const deps: CliDeps = {
      readStdin: readTokenFromStdin,
      persist: (token: string) => persistCredential(EDS_DOMAIN, token),
      client,
      org,
      ...(process.env.EDS_SITE !== undefined ? { site: process.env.EDS_SITE } : {}),
    };
    await main(process.argv.slice(2), deps);
  }
}
