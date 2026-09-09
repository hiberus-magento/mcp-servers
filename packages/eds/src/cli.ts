// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The `hiberus-eds` CLI adapter's auth surface (design.md, Decision 6;
// eds-cli spec). This module is the entry POINT for auth wiring — it is
// NOT yet the shebang executable; Phase 9 (out of scope for this batch)
// finalizes the shebang + full dispatch table over the CLI-only operations
// excluded from the MCP surface (Phase 8). `runCli` here handles exactly
// the `auth token set` / `auth mint` / `auth status` subcommands.
//
// A token is NEVER accepted as a CLI argument. `parseCredentialCliArgs`
// (mcp-core) runs before ANY dispatch, so `--token`/`--token=` is rejected
// before persisting anything. `auth token set` additionally rejects any
// extra positional argument — its handler (`setToken`) has no parameter to
// receive one at all, so a positional token would have nowhere to go even
// if this check were removed (design.md, Decision 6, layers 1–2).
import { parseCredentialCliArgs, redact } from "@hiberus-magento/mcp-core";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { EdsClient } from "./client/index.js";
import { resolveEdsCredentialDirect } from "./credential-provider.js";

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

// Confirmed only against this repository's own design.md bootstrap example
// (`hiberus-eds auth mint --scope site --roles publish,author`) — NOT
// independently re-verified against https://www.aem.live/docs/admin.html in
// this session (no live web-fetch capability was available here). The four
// CLI-observed-only roles (basic_author, basic_publish, config, config_admin)
// are deliberately excluded and rejected until corroborated by a human with
// access to the live docs (design.md, Open Question 3). Reported as a
// residual risk in this batch's apply summary — do not treat this list as
// independently doc-verified.
const CONFIRMED_ROLES = ["author", "publish"] as const;
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
