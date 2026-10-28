#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The `hiberus-aem-sites` operator CLI (aem-sites-package, tasks.md 5.1).
//
//   auth token set --env E          token from stdin only (never argv)
//   auth token clear --env E --yes  removes the stored token file
//   auth status [--env E]           the QueryBuilder probe, per environment
//   pages list --env E --root R [--limit N] [--offset N]
//   plan  --env E --operation F|-   prints the plan; writes nothing
//   apply --env E --operation F|- [--confirm-target T] [--yes]
//
// Like the project's field CLI, nothing writes without `--yes`: `apply`
// without it prints the plan and stops. Plan and apply run in ONE process
// here (the plan store is in memory), with the same checks `aem_apply` runs.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { credentialFilePath, MissingCredentialError, parseCredentialCliArgs, persistCredential, readTokenFromStdin, redact } from "@hiberus-magento/mcp-core";
import { AemAuthError, probeAuth, queryPages } from "./client/index.js";
import { parseConfig } from "./config.js";
import { assertEnvName, credentialDomain, normalizeToken, resolveAemTokenDirect } from "./credential-provider.js";
import { assertReadable } from "./guard/paths.js";
import { createRuntimeResolver, type AemRuntime } from "./tools/aem-tools.js";
import { applyPlan } from "./tools/apply.js";
import { planOperation } from "./tools/plan-builder.js";
import { aemPlanInput } from "./tools/plan-schema.js";

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface CliDeps {
  readonly readStdin: () => Promise<string>;
  readonly readFile: (path: string) => string;
  readonly persist: (domain: string, token: string) => string;
  readonly removeFile: (path: string) => boolean;
  readonly getRuntime: () => AemRuntime;
  readonly configDir?: string;
}

const USAGE = `Usage:
  hiberus-aem-sites auth token set --env <env>            (token on stdin)
  hiberus-aem-sites auth token clear --env <env> --yes
  hiberus-aem-sites auth status [--env <env>]
  hiberus-aem-sites pages list --env <env> --root <path> [--limit N] [--offset N]
  hiberus-aem-sites plan --env <env> --operation <file|->
  hiberus-aem-sites apply --env <env> --operation <file|-> [--confirm-target <text>] [--yes]`;

const BOOLEAN_FLAGS = new Set(["--yes"]);

function parseFlags(args: readonly string[]): { readonly flags: Record<string, string>; readonly rest: readonly string[] } {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (BOOLEAN_FLAGS.has(arg)) {
      flags[arg.slice(2)] = "true";
    } else if (arg.startsWith("--")) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} needs a value.`);
      }
      flags[arg.slice(2)] = value;
      i += 1;
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

const ok = (stdout: string, stderr?: string): CliRunResult => ({ exitCode: 0, stdout: redact(stdout.endsWith("\n") ? stdout : `${stdout}\n`), ...(stderr !== undefined ? { stderr } : {}) });
const fail = (stderr: string): CliRunResult => ({ exitCode: 1, stderr: redact(stderr) });

async function tokenSet(deps: CliDeps, envName: string): Promise<CliRunResult> {
  assertEnvName(envName);
  try {
    resolveAemTokenDirect(envName, deps.configDir);
  } catch (error) {
    if (error instanceof Error && error.name === "LooseCredentialFilePermissionsError") {
      return fail(error.message);
    }
  }
  const token = normalizeToken(await deps.readStdin());
  if (token === undefined) {
    return fail("No usable token on stdin. Paste the local development token (raw, Bearer-prefixed or the Developer Console JSON).");
  }
  const path = deps.persist(credentialDomain(envName), token);
  return { exitCode: 0, stderr: `Token for "${envName}" stored in ${path} (mode 0600).` };
}

function tokenClear(deps: CliDeps, envName: string, yes: boolean): CliRunResult {
  const path = credentialFilePath(credentialDomain(assertEnvName(envName)), deps.configDir);
  if (!yes) {
    return ok(`SIMULATION: would remove ${path}. Add --yes.`);
  }
  return deps.removeFile(path) ? ok(`Removed ${path}.`) : ok(`Nothing stored at ${path}.`);
}

async function authStatus(deps: CliDeps, only: string | undefined): Promise<CliRunResult> {
  const runtime = deps.getRuntime();
  const names = only !== undefined ? [only] : [...runtime.config.authors.keys()];
  const probeRoot = runtime.config.writeRoots[0] ?? "/content";
  const lines: string[] = [];
  let bad = 0;
  for (const name of names) {
    const origin = runtime.config.authors.get(name);
    if (origin === undefined) {
      return fail(`Unknown environment "${name}".`);
    }
    lines.push(`${name}`, `  author        ${origin}`, `  token         ${runtime.tokenSource(name)}`);
    try {
      const { status } = await probeAuth(runtime.clientFor(name).http, probeRoot);
      lines.push(`  QueryBuilder  HTTP ${status} OK`);
    } catch (error) {
      bad += 1;
      if (error instanceof AemAuthError) {
        lines.push(`  QueryBuilder  HTTP ${error.status ?? "-"} ${error.reason} → ${error.remedy.cliCommand}`);
      } else if (error instanceof MissingCredentialError) {
        lines.push(`  QueryBuilder  not run: no token → ${error.remedy.cliCommand}`);
      } else {
        lines.push(`  QueryBuilder  ${(error as Error).message}`);
      }
    }
  }
  return { exitCode: bad > 0 ? 1 : 0, stdout: redact(`${lines.join("\n")}\n`) };
}

async function pagesList(deps: CliDeps, flags: Record<string, string>): Promise<CliRunResult> {
  if (flags.env === undefined || flags.root === undefined) {
    return fail(USAGE);
  }
  const runtime = deps.getRuntime();
  const list = await queryPages(runtime.clientFor(flags.env).http, {
    root: assertReadable(flags.root),
    ...(flags.limit !== undefined ? { limit: Number(flags.limit) } : {}),
    ...(flags.offset !== undefined ? { offset: Number(flags.offset) } : {}),
  });
  const lines = list.pages.map((page) => `${page.path}${page.title !== undefined ? `  ${page.title}` : ""}`);
  return ok(`${lines.join("\n")}\n── ${list.pages.length} of ${list.total}${list.more ? ` · more: --offset ${list.offset + list.pages.length}` : ""}`);
}

async function planOrApply(deps: CliDeps, flags: Record<string, string>, applyIt: boolean): Promise<CliRunResult> {
  if (flags.env === undefined || flags.operation === undefined) {
    return fail(USAGE);
  }
  const raw = flags.operation === "-" ? await deps.readStdin() : deps.readFile(flags.operation);
  let operation: unknown;
  try {
    operation = JSON.parse(raw);
  } catch {
    return fail("The operation is not valid JSON.");
  }
  const parsed = aemPlanInput.safeParse({ env: flags.env, operation });
  if (!parsed.success) {
    return fail(`Invalid operation: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  const runtime = deps.getRuntime();
  const plan = await planOperation({ config: runtime.config, clientFor: runtime.clientFor, store: runtime.store, now: runtime.now }, parsed.data);
  if (plan.status === "rejected") {
    return fail(`Rejected (${plan.reason}): ${plan.message}`);
  }
  if (plan.status === "no-changes") {
    return ok(`No changes: ${plan.summary}`);
  }
  if (!applyIt || flags.yes !== "true") {
    return ok(`${plan.confirmationMessage}\n\n${applyIt ? "SIMULATION. Nothing written. Add --yes." : "Plan only. Nothing written."}`);
  }
  const result = await applyPlan(
    { config: runtime.config, clientFor: runtime.clientFor, store: runtime.store, sleep: runtime.sleep },
    { token: plan.token, env: plan.env, kind: plan.kind, ...(flags["confirm-target"] !== undefined ? { confirmTarget: flags["confirm-target"] } : {}) },
  );
  if (result.status === "applied") {
    return ok(`${plan.confirmationMessage}\n\n${result.results.map((step) => `✓ ${step.label} → HTTP ${step.status}`).join("\n")}`);
  }
  if (result.status === "rejected") {
    return fail(`Not applied (${result.reason}): ${result.message}`);
  }
  return fail(
    `${result.completed.map((step) => `✓ ${step.label} → HTTP ${step.status}`).join("\n")}\n✗ ${result.failed.label}: ${result.failed.message}\n${result.notSent} request(s) not sent.`,
  );
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<CliRunResult> {
  const credentialArgs = parseCredentialCliArgs(argv);
  if (!credentialArgs.ok) {
    return fail(credentialArgs.error.message);
  }
  let parsed: ReturnType<typeof parseFlags>;
  try {
    parsed = parseFlags(argv);
  } catch (error) {
    return fail((error as Error).message);
  }
  const { flags, rest } = parsed;
  const command = rest.join(" ");
  try {
    if (command === "auth token set") {
      return flags.env === undefined ? fail("auth token set needs --env <env>; the token is read from stdin, never from an argument.") : tokenSet(deps, flags.env);
    }
    if (command === "auth token clear") {
      return flags.env === undefined ? fail(USAGE) : tokenClear(deps, flags.env, flags.yes === "true");
    }
    if (command === "auth status") {
      return await authStatus(deps, flags.env);
    }
    if (command === "pages list") {
      return await pagesList(deps, flags);
    }
    if (command === "plan" || command === "apply") {
      return await planOrApply(deps, flags, command === "apply");
    }
  } catch (error) {
    return fail((error as Error).message);
  }
  return fail(argv.length === 0 ? USAGE : `Unknown command: ${argv.join(" ")}\n${USAGE}`);
}

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

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const argv = process.argv.slice(2);
  const needsConfig = !(argv[0] === "auth" && argv[1] === "token");
  let configError: string | undefined;
  if (needsConfig) {
    try {
      parseConfig(process.env);
    } catch (error) {
      configError = (error as Error).message;
    }
  }
  if (configError !== undefined) {
    process.stderr.write(`hiberus-aem-sites: ${configError}\n`);
    process.exitCode = 1;
  } else {
    await main(argv, {
      readStdin: readTokenFromStdin,
      readFile: (path) => readFileSync(path, "utf8"),
      persist: (domain, token) => persistCredential(domain, token),
      removeFile: (path) => {
        if (!existsSync(path)) {
          return false;
        }
        rmSync(path);
        return true;
      },
      getRuntime: createRuntimeResolver(),
    });
  }
}
