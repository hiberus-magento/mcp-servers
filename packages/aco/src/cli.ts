#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The `hiberus-aco` CLI adapter (aco-cli spec; design.md, Decisions 0 & 2).
// Every operation on `CLI_ONLY_OPERATIONS` (provision, policy disable --all,
// view prune, view delete, policy delete, auth/profile, api query, and
// policy init) has NO MCP tool registration — verified independently in
// `tools/aco-tools.test.ts` (Phase 5, task 5.1's negative assertion).
//
// A credential is NEVER accepted as a CLI argument. `parseCredentialCliArgs`
// (mcp-core) runs before ANY dispatch, so `--token`/`--token=` is rejected
// before persisting anything. `auth token set` reads the Bearer from stdin
// only; the IMS client id/secret is read from `ACO_CLIENT_ID`/
// `ACO_CLIENT_SECRET` environment variables only — there is no flag for
// either anywhere in `CLI_OPTIONS`.
import { parseCredentialCliArgs, persistCredential, readTokenFromStdin, redact } from "@hiberus-magento/mcp-core";
import { pathToFileURL } from "node:url";
import type { AcoClient, ProvisionOptions, ProvisionVerticalInput } from "./client/index.js";
import { createAcoClient } from "./client/index.js";
import {
  ACO_CLIENT_ID_ENV_VAR,
  ACO_CLIENT_SECRET_ENV_VAR,
  ACO_DOMAIN,
  createAdminTokenProvider,
  resolveAcoCredentialDirect,
  selectAdminProvider,
} from "./credential-provider.js";
import { projectPolicyForUpdate } from "./policy-update.js";

// ---------------------------------------------------------------------------
// CLI-only operations (aco-cli spec, "CLI-Only Operations Excluded from
// MCP"). Exported so both this file's own dispatch test (4.5) and Phase 5's
// negative six-tools test can assert against ONE list, never two that could
// drift apart.
// ---------------------------------------------------------------------------
export const CLI_ONLY_OPERATIONS = [
  "provision",
  "policy disable --all",
  "policy delete",
  "policy init",
  "view prune",
  "view delete",
  "auth token set",
  "auth mint",
  "auth status",
  "profile show",
  "api query",
] as const;

export interface OptionSpec {
  readonly name: string;
  readonly description: string;
}

/** No option here may ever carry a credential value — proven by cli.test.ts. */
export const CLI_OPTIONS: readonly OptionSpec[] = [
  { name: "--yes", description: "Confirm a write (provision, policy disable --all, view prune, view delete, policy delete)." },
  { name: "--file", description: "Path to a JSON input file (provision's verticals, policy init's scaffold target)." },
  { name: "--name", description: "Target policy name (policy delete)." },
  { name: "--view", description: "Target catalog view name or viewId (view delete)." },
  { name: "--document", description: "Raw GraphQL document text (api query)." },
  { name: "--variables", description: "JSON-encoded GraphQL variables (api query)." },
  { name: "--merchandising", description: "Route api query at the Merchandising endpoint instead of the admin endpoint." },
  { name: "--view-id", description: "AC-View-ID for a Merchandising api query." },
  { name: "--locale", description: "AC-Scope-Locale for a Merchandising api query." },
];

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface CliDeps {
  readonly client: AcoClient;
  readonly configDir?: string;
  readonly readStdin: () => Promise<string>;
  readonly persist: (token: string) => string;
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, contents: string) => Promise<void>;
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

function renderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Threat matrix (design.md): Adobe's own error text is surfaced verbatim
  // by design and is carried as a JSON string field, never interpolated
  // into a command, a path, or a URL — this package executes nothing, so
  // there is no injection sink. redact() is still applied before writing to
  // stderr, so a token-shaped value inside an upstream message is masked.
  return redact(message);
}

// ---------------------------------------------------------------------------
// auth token set / auth mint / auth status
// ---------------------------------------------------------------------------

async function runAuthTokenSet(extra: readonly string[], deps: CliDeps): Promise<CliRunResult> {
  if (extra.length > 0) {
    return {
      exitCode: 1,
      stderr: 'auth token set takes no arguments — pipe the token via stdin instead (e.g. echo "$TOKEN" | hiberus-aco auth token set).',
    };
  }
  const token = await deps.readStdin();
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return { exitCode: 1, stderr: "auth token set received an empty token on stdin." };
  }
  const path = deps.persist(trimmed);
  return { exitCode: 0, stdout: `Token persisted to ${path} (mode 0600).\n` };
}

async function runAuthMint(deps: CliDeps): Promise<CliRunResult> {
  const tokenProvider = createAdminTokenProvider({ now: () => Date.now(), fetch: globalThis.fetch, ...(deps.configDir !== undefined ? { configDir: deps.configDir } : {}) });
  const decision = selectAdminProvider({
    storedOrEnvBearer: hasStoredOrEnvBearerFor(deps.configDir),
    clientCredentials: hasClientCredentialsFor(),
  });
  if (decision.selection === "pasted-bearer") {
    return { exitCode: 1, stderr: `A stored/env Bearer already takes precedence (${decision.reason}). Remove it first if you want to force a mint.` };
  }
  try {
    const credential = await tokenProvider.getToken();
    return { exitCode: 0, stdout: `Minted an admin credential (kind: ${credential.kind}).\n`, stderr: 'Next: echo "<value>" | hiberus-aco auth token set   (only if you want to pin this value instead of re-minting)' };
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }
}

function hasStoredOrEnvBearerFor(configDir?: string): boolean {
  try {
    resolveAcoCredentialDirect(configDir);
    return true;
  } catch {
    return false;
  }
}

function hasClientCredentialsFor(): boolean {
  const id = process.env[ACO_CLIENT_ID_ENV_VAR];
  const secret = process.env[ACO_CLIENT_SECRET_ENV_VAR];
  return id !== undefined && id !== "" && secret !== undefined && secret !== "";
}

async function runAuthStatus(deps: CliDeps): Promise<CliRunResult> {
  const decision = selectAdminProvider({
    storedOrEnvBearer: hasStoredOrEnvBearerFor(deps.configDir),
    clientCredentials: hasClientCredentialsFor(),
  });
  const lines = [`selection: ${decision.selection}`, `reason: ${decision.reason}`];
  return { exitCode: decision.selection === "none" ? 1 : 0, stdout: `${lines.join("\n")}\n` };
}

async function runProfileShow(deps: CliDeps): Promise<CliRunResult> {
  // "profile"/"auth" commands are inherently CLI-only (interactive
  // credential management) — profile show is a thin alias over auth status,
  // kept as its own recognized command so it never collides with an MCP
  // tool name (aco-cli spec, "CLI-Only Operations Excluded from MCP").
  return runAuthStatus(deps);
}

// ---------------------------------------------------------------------------
// provision — dry-run by default (aco-cli spec, "provision Defaults to Dry-Run")
// ---------------------------------------------------------------------------

interface ProvisionFileShape {
  readonly verticals: readonly ProvisionVerticalInput[];
}

async function runProvision(flags: Record<string, string>, deps: CliDeps): Promise<CliRunResult> {
  const filePath = flags["file"];
  if (filePath === undefined) {
    return { exitCode: 1, stderr: "provision requires --file <path-to-verticals.json>." };
  }
  let parsed: ProvisionFileShape;
  try {
    const raw = await deps.readFile(filePath);
    parsed = JSON.parse(raw) as ProvisionFileShape;
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }

  const write = flags["yes"] === "true";
  const options: ProvisionOptions = { verticals: parsed.verticals, write };
  try {
    const result = await deps.client.provisioning.provision(options);

    const summaryLines = result.steps.map((step) => `${step.step}: ${step.changed ? "changed" : "no-op"} — ${step.detail}`);
    if (result.aborted) {
      return { exitCode: 1, stdout: `${summaryLines.join("\n")}\n`, stderr: "provision aborted before any write (zero-match vertical)." };
    }
    const modeLine = result.dryRun ? "This was a dry run — pass --yes to apply." : "Writes were applied.";
    return { exitCode: 0, stdout: `${summaryLines.join("\n")}\n${modeLine}\n` };
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }
}

// ---------------------------------------------------------------------------
// policy list / policy disable --all / policy delete / policy init
// ---------------------------------------------------------------------------

async function runPolicyList(deps: CliDeps): Promise<CliRunResult> {
  try {
    const result = await deps.client.policies.listPolicies();
    return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n` };
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }
}

/**
 * "Disable a policy" does not exist in this API: `UpdatePolicyRequest` has
 * no `enabled` member, and the Admin UI offers enable/disable on a FILTER
 * only. The nearest honest reading of `policy disable --all` is therefore
 * "disable every FILTER of every policy", which is what this does — one
 * whole-policy replacement per policy that still has an enabled filter,
 * since `updatePolicy` replaces rather than patches.
 *
 * A policy the read cannot describe completely enough to write back is
 * SKIPPED and named, never written with defaulted fields: the write would
 * destroy whatever the read failed to carry.
 */
async function runPolicyDisableAll(flags: Record<string, string>, deps: CliDeps): Promise<CliRunResult> {
  const write = flags["yes"] === "true";
  try {
    const { policies } = await deps.client.policies.listPolicies();
    const withEnabledFilters = policies.filter((policy) => (policy.actions ?? []).some((action) => (action.filters ?? []).some((filter) => filter.enabled === true)));
    if (!write) {
      return { exitCode: 0, stdout: `Dry run — would disable every filter of ${countPolicies(withEnabledFilters.length)}. Pass --yes to apply.\n` };
    }

    const skipped: string[] = [];
    let disabled = 0;
    for (const policy of withEnabledFilters) {
      const allFiltersOff = { ...policy, actions: (policy.actions ?? []).map((action) => ({ ...action, ...(action.filters === undefined ? {} : { filters: action.filters.map((filter) => ({ ...filter, enabled: false })) }) })) };
      const projection = projectPolicyForUpdate(allFiltersOff);
      if (!projection.ok) {
        skipped.push(`${policy.name} (no value read for ${projection.missing.join(", ")})`);
        continue;
      }
      await deps.client.policies.updatePolicy(projection.input);
      disabled += 1;
    }

    const summary = `Disabled every filter of ${countPolicies(disabled)}.\n`;
    if (skipped.length > 0) {
      return { exitCode: 1, stdout: summary, stderr: `Skipped without writing, to avoid destroying unread fields: ${skipped.join("; ")}.` };
    }
    return { exitCode: 0, stdout: summary };
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }
}

function countPolicies(count: number): string {
  return `${String(count)} polic${count === 1 ? "y" : "ies"}`;
}

async function runPolicyDelete(flags: Record<string, string>, deps: CliDeps): Promise<CliRunResult> {
  const name = flags["name"];
  if (name === undefined) {
    return { exitCode: 1, stderr: "policy delete requires --name <policy-name>." };
  }
  if (flags["yes"] !== "true") {
    return { exitCode: 1, stderr: "policy delete is destructive — pass --yes to confirm." };
  }
  try {
    const { policies } = await deps.client.policies.listPolicies();
    const target = policies.find((policy) => policy.name === name);
    if (target === undefined) {
      return { exitCode: 1, stderr: `No policy named "${name}" was found.` };
    }
    await deps.client.policies.deletePolicy({ policyId: target.policyId });
    return { exitCode: 0, stdout: `Deleted policy "${name}" (${target.policyId}).\n` };
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }
}

/**
 * exploration.md flags the Python CLI's local-CSV policy scaffold as
 * "vestigial ... do not port": the CSV-file-as-state-store pattern is a
 * local-dev artifact tied to that operator's own workflow, not a shape
 * Adobe's API exposes. What IS ported, minimally: a starter template an
 * operator can fill in by hand before writing their own `provision --file`
 * input — never read back by this CLI itself.
 */
async function runPolicyInit(flags: Record<string, string>, deps: CliDeps): Promise<CliRunResult> {
  const filePath = flags["file"];
  if (filePath === undefined) {
    return { exitCode: 1, stderr: "policy init requires --file <path> to write the starter template to." };
  }
  const template = "vertical,policy_name\n";
  await deps.writeFile(filePath, template);
  return { exitCode: 0, stdout: `Wrote a starter policy template to ${filePath}.\n` };
}

// ---------------------------------------------------------------------------
// view list / view delete / view prune
// ---------------------------------------------------------------------------

async function runViewList(deps: CliDeps): Promise<CliRunResult> {
  try {
    const result = await deps.client.catalogViews.listCatalogViews();
    return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n` };
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }
}

async function runViewDelete(flags: Record<string, string>, deps: CliDeps): Promise<CliRunResult> {
  const view = flags["view"];
  if (view === undefined) {
    return { exitCode: 1, stderr: "view delete requires --view <name-or-viewId>." };
  }
  if (flags["yes"] !== "true") {
    return { exitCode: 1, stderr: "view delete is destructive — pass --yes to confirm." };
  }
  try {
    const { views } = await deps.client.catalogViews.listCatalogViews();
    const target = views.find((v) => v.viewId === view || v.name === view);
    if (target === undefined) {
      return { exitCode: 1, stderr: `No catalog view matching "${view}" was found.` };
    }
    const { deletedViewId } = await deps.client.catalogViews.deleteCatalogView({ viewId: target.viewId });
    return { exitCode: 0, stdout: `Deleted catalog view "${view}" (${deletedViewId}).\n` };
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }
}

/**
 * Bulk-deletes ALL draft views in one pass (exploration.md). The blast
 * radius scales with tenant state, not with a bounded input array —
 * structurally different from a `nonEmptyPaths`-style schema gate, and
 * exactly why this stays a CLI-only, `--yes`-gated bulk operation, never an
 * MCP tool.
 *
 * CHANGED DELIBERATELY: a draft used to be a view whose NAME matched
 * `/_draft$/i`. `catalogViews` reports a real `draft` flag, and this
 * command DELETES what it calls a draft — deciding that from a name while
 * the API states it is the defect class this package keeps finding. The
 * test is `=== true`, not `!== false`: a view the server did not report
 * `draft` for is not deleted.
 */
async function runViewPrune(flags: Record<string, string>, deps: CliDeps): Promise<CliRunResult> {
  const write = flags["yes"] === "true";
  try {
    const { views } = await deps.client.catalogViews.listCatalogViews();
    const drafts = views.filter((v) => v.draft === true);
    if (!write) {
      return { exitCode: 0, stdout: `Dry run — would prune ${drafts.length} draft view(s). Pass --yes to apply.\n` };
    }
    for (const draft of drafts) {
      await deps.client.catalogViews.deleteCatalogView({ viewId: draft.viewId });
    }
    return { exitCode: 0, stdout: `Pruned ${drafts.length} draft view(s).\n` };
  } catch (error) {
    return { exitCode: 1, stderr: renderError(error) };
  }
}

// ---------------------------------------------------------------------------
// api query — the raw GraphQL escape hatch (exploration.md: "an
// unconstrained query string is the opposite of a task-shaped tool" — CLI
// only). Bypasses the typed operation catalog via `client.raw`.
// ---------------------------------------------------------------------------

async function runApiQuery(flags: Record<string, string>, deps: CliDeps): Promise<CliRunResult> {
  const document = flags["document"];
  if (document === undefined) {
    return { exitCode: 1, stderr: "api query requires --document <graphql-text>." };
  }
  let variables: Record<string, unknown> | undefined;
  if (flags["variables"] !== undefined) {
    try {
      variables = JSON.parse(flags["variables"]) as Record<string, unknown>;
    } catch (error) {
      return { exitCode: 1, stderr: renderError(error) };
    }
  }
  try {
    if (flags["merchandising"] === "true") {
      const viewId = flags["view-id"];
      const locale = flags["locale"];
      if (viewId === undefined || locale === undefined) {
        return { exitCode: 1, stderr: "api query --merchandising requires --view-id and --locale." };
      }
      const result = await deps.client.raw.queryMerchandising(document, variables, { viewId, locale });
      return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n` };
    }
    const result = await deps.client.raw.queryAdmin(document, variables);
    return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n` };
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
  if (group === "auth" && sub === "mint") {
    return runAuthMint(deps);
  }
  if (group === "auth" && sub === "status") {
    return runAuthStatus(deps);
  }
  if (group === "profile" && sub === "show") {
    return runProfileShow(deps);
  }
  if (group === "provision") {
    return runProvision(flags, deps);
  }
  if (group === "policy" && sub === "list") {
    return runPolicyList(deps);
  }
  if (group === "policy" && sub === "disable" && flags["all"] === "true") {
    return runPolicyDisableAll(flags, deps);
  }
  if (group === "policy" && sub === "delete") {
    return runPolicyDelete(flags, deps);
  }
  if (group === "policy" && sub === "init") {
    return runPolicyInit(flags, deps);
  }
  if (group === "view" && sub === "list") {
    return runViewList(deps);
  }
  if (group === "view" && sub === "delete") {
    return runViewDelete(flags, deps);
  }
  if (group === "view" && sub === "prune") {
    return runViewPrune(flags, deps);
  }
  if (group === "api" && sub === "query") {
    return runApiQuery(flags, deps);
  }

  return { exitCode: 1, stderr: `Unknown command: ${argv.join(" ")}` };
}

/**
 * The process-facing entrypoint (aco-cli spec, "Exit Codes Reflect
 * Outcome"): runs `runCli` (pure and side-effect-free for testability) and
 * maps its `exitCode` onto `process.exitCode` — never `process.exit()`,
 * which would truncate any still-in-flight stdout/stderr write.
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
// a real credential or reading real stdin (mirrors `eds`'s `mcp.ts` guard).
// ---------------------------------------------------------------------------

const ADMIN_BASE_URL_ENV_VAR = "ACO_ADMIN_BASE_URL";
const MERCHANDISING_BASE_URL_ENV_VAR = "ACO_MERCHANDISING_BASE_URL";
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const adminBaseUrl = process.env[ADMIN_BASE_URL_ENV_VAR];
  const merchandisingBaseUrl = process.env[MERCHANDISING_BASE_URL_ENV_VAR];
  if (adminBaseUrl === undefined || merchandisingBaseUrl === undefined) {
    process.stderr.write(`hiberus-aco: ${ADMIN_BASE_URL_ENV_VAR} and ${MERCHANDISING_BASE_URL_ENV_VAR} are both required.\n`);
    process.exitCode = 1;
  } else {
    const client = createAcoClient({
      fetch: globalThis.fetch,
      now: () => Date.now(),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      adminBaseUrl,
      merchandisingBaseUrl,
      tokenProvider: createAdminTokenProvider({ now: () => Date.now(), fetch: globalThis.fetch }),
      ...(process.env["ACO_API_KEY"] !== undefined ? { apiKey: process.env["ACO_API_KEY"] } : {}),
      ...(process.env["ACO_IMS_ORG_ID"] !== undefined ? { imsOrgId: process.env["ACO_IMS_ORG_ID"] } : {}),
    });
    const deps: CliDeps = {
      client,
      readStdin: readTokenFromStdin,
      persist: (token: string) => persistCredential(ACO_DOMAIN, token),
      readFile: (path: string) => import("node:fs/promises").then((fs) => fs.readFile(path, "utf8")),
      writeFile: (path: string, contents: string) => import("node:fs/promises").then((fs) => fs.writeFile(path, contents, "utf8")),
    };
    await main(process.argv.slice(2), deps);
  }
}
