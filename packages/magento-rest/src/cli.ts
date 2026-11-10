#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The `hiberus-magento-rest` operator CLI. It exists for exactly one reason
// an MCP server cannot serve: a human typing a credential. Two commands:
//
//   auth token set        reads the token from STDIN, stores it at mode 0600
//   auth db-password set  the same, for the database password (MAGENTO_REST_DATABASE_CONNECTION carries none)
//   auth status           shows the stored token's fingerprint and probes Magento
//
// A credential is NEVER accepted as an argument: `parseCredentialCliArgs`
// (mcp-core) runs before any dispatch and has no `--token` option at all, so
// shell history cannot hold one even by accident. Nothing here ever prints a
// token — `status` shows a short SHA-256 fingerprint so two operators can
// agree they hold the same key without either reading it out.
//
// There is deliberately no command that reads or writes catalog data: the
// MCP tools are the data surface, and a second one here would be a second
// place to keep the write switch honest.
import { createHash } from "node:crypto";
import { parseCredentialCliArgs, persistCredential, readTokenFromStdin, redact } from "@hiberus-magento/mcp-core";
import { pathToFileURL } from "node:url";
import { MagentoRestError } from "./client/index.js";
import { MAGENTO_REST_DOMAIN, resolveMagentoToken } from "./credential-provider.js";
import { DATABASE_CREDENTIAL_DOMAIN } from "./db/connection.js";
import { createRuntimeResolver } from "./tools/runtime.js";

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface CliDeps {
  readonly readStdin: () => Promise<string>;
  readonly persist: (token: string) => string;
  readonly persistDbPassword: (password: string) => string;
  readonly resolveToken: () => string;
  /** One cheap authenticated read; throws if Magento refuses it or is unreachable. */
  readonly probe: () => Promise<unknown>;
}

async function setToken(deps: CliDeps): Promise<CliRunResult> {
  const token = (await deps.readStdin()).trim();
  if (token === "") {
    return {
      exitCode: 1,
      stderr: 'No token received on stdin. Pipe it in, e.g. echo "$TOKEN" | hiberus-magento-rest auth token set.',
    };
  }
  const path = deps.persist(token);
  return { exitCode: 0, stdout: `Token stored in ${path} (mode 0600).\n` };
}

async function setDbPassword(deps: CliDeps): Promise<CliRunResult> {
  const password = (await deps.readStdin()).trim();
  if (password === "") {
    return {
      exitCode: 1,
      stderr: 'No password received on stdin. Pipe it in, e.g. printf "%s" "$DB_PASSWORD" | hiberus-magento-rest auth db-password set.',
    };
  }
  const path = deps.persistDbPassword(password);
  return { exitCode: 0, stdout: `Database password stored in ${path} (mode 0600).\n` };
}

async function authStatus(deps: CliDeps): Promise<CliRunResult> {
  let token: string;
  try {
    token = deps.resolveToken();
  } catch (error) {
    // Verbatim (not rewrapped): a missing token names the command, variable
    // and file, and a loose-permission file says so.
    return { exitCode: 1, stderr: redact((error as Error).message) };
  }
  const fingerprint = createHash("sha256").update(token).digest("hex").slice(0, 8);
  const lines = [`key fingerprint: ${fingerprint}`];
  try {
    await deps.probe();
  } catch (error) {
    const detail =
      error instanceof MagentoRestError
        ? `${error.kind}: ${error.message}${error.remedy !== undefined ? `\nRemedy: ${error.remedy}` : ""}`
        : redact(error instanceof Error ? error.message : "unknown failure");
    return { exitCode: 1, stdout: `${lines.join("\n")}\n`, stderr: detail };
  }
  lines.push("reachable: GET /store/websites succeeded");
  return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
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
        stderr: 'auth token set takes no arguments — pipe the token via stdin instead (e.g. echo "$TOKEN" | hiberus-magento-rest auth token set).',
      };
    }
    return setToken(deps);
  }
  if (group === "auth" && sub === "db-password" && action === "set") {
    if (extra.length > 0) {
      return {
        exitCode: 1,
        stderr: "auth db-password set takes no arguments — pipe the password via stdin instead, so it never reaches shell history.",
      };
    }
    return setDbPassword(deps);
  }
  if (group === "auth" && sub === "status" && action === undefined) {
    return authStatus(deps);
  }
  return { exitCode: 1, stderr: `Unknown command: ${argv.join(" ")}` };
}

/**
 * The process-facing entrypoint: runs `runCli` (pure, returns what to write)
 * and maps its `exitCode` onto `process.exitCode` — never `process.exit()`,
 * which would truncate a still-in-flight write.
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

// Only runs when this module is the process entrypoint, so `cli.test.ts` can
// import `runCli` without resolving a real credential or reading real stdin.
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const getRuntime = createRuntimeResolver();
  await main(process.argv.slice(2), {
    readStdin: readTokenFromStdin,
    persist: (token: string) => persistCredential(MAGENTO_REST_DOMAIN, token),
    persistDbPassword: (password: string) => persistCredential(DATABASE_CREDENTIAL_DOMAIN, password),
    resolveToken: () => resolveMagentoToken(),
    probe: () => getRuntime().client.get("/store/websites"),
  });
}
