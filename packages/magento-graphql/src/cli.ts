#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The `hiberus-magento-graphql` operator CLI. It exists for exactly one reason an MCP server
// cannot serve: a human typing a credential. Two commands:
//
//   auth token set   reads the CUSTOMER token from STDIN, stores it at mode 0600
//   auth status      shows the token's fingerprint (or that calls are anonymous) and probes the endpoint
//
// The token is optional: the storefront schema is public, and only the customer tools need one.
// A credential is NEVER accepted as an argument: `parseCredentialCliArgs` (mcp-core) runs before
// any dispatch and has no `--token` option at all, so shell history cannot hold one even by
// accident. Nothing here ever prints a token — `status` shows a short SHA-256 fingerprint.
//
// There is deliberately no command that reads or writes store data: the MCP tools are the data
// surface, and a second one here would be a second place to keep the write switch honest.
import { createHash } from "node:crypto";
import { parseCredentialCliArgs, persistCredential, readTokenFromStdin, redact } from "@hiberus-magento/mcp-core";
import { pathToFileURL } from "node:url";
import { MagentoGraphqlError } from "./client/index.js";
import { MAGENTO_GRAPHQL_DOMAIN, resolveOptionalCustomerToken } from "./credential-provider.js";
import { createRuntimeResolver } from "./tools/runtime.js";

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface CliDeps {
  readonly readStdin: () => Promise<string>;
  readonly persist: (token: string) => string;
  /** The stored token, `undefined` when there is none; throws when a credential file cannot be used. */
  readonly resolveToken: () => string | undefined;
  /** One cheap read; throws if Magento refuses it or is unreachable. */
  readonly probe: () => Promise<unknown>;
}

async function setToken(deps: CliDeps): Promise<CliRunResult> {
  const token = (await deps.readStdin()).trim();
  if (token === "") {
    return { exitCode: 1, stderr: 'No token received on stdin. Pipe it in, e.g. echo "$TOKEN" | hiberus-magento-graphql auth token set.' };
  }
  const path = deps.persist(token);
  return { exitCode: 0, stdout: `Customer token stored in ${path} (mode 0600).\n` };
}

async function authStatus(deps: CliDeps): Promise<CliRunResult> {
  let token: string | undefined;
  try {
    token = deps.resolveToken();
  } catch (error) {
    // Verbatim: a credential file with loose permissions says so, instead of being treated as "no token".
    return { exitCode: 1, stderr: redact((error as Error).message) };
  }
  const lines = [token === undefined ? "customer token: none — calls are anonymous (public storefront schema only)" : `customer token fingerprint: ${createHash("sha256").update(token).digest("hex").slice(0, 8)}`];
  try {
    await deps.probe();
  } catch (error) {
    const detail =
      error instanceof MagentoGraphqlError
        ? `${error.kind}: ${error.message}${error.remedy !== undefined ? `\nRemedy: ${error.remedy}` : ""}`
        : redact(error instanceof Error ? error.message : "unknown failure");
    return { exitCode: 1, stdout: `${lines.join("\n")}\n`, stderr: detail };
  }
  lines.push("reachable: the storeConfig query succeeded");
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
      return { exitCode: 1, stderr: 'auth token set takes no arguments — pipe the token via stdin instead (e.g. echo "$TOKEN" | hiberus-magento-graphql auth token set).' };
    }
    return setToken(deps);
  }
  if (group === "auth" && sub === "status" && action === undefined) {
    return authStatus(deps);
  }
  return { exitCode: 1, stderr: `Unknown command: ${argv.join(" ")}` };
}

/** Runs `runCli` (pure, returns what to write) and maps `exitCode` onto `process.exitCode` — never `process.exit()`, which would truncate a still-in-flight write. */
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

// Only runs when this module is the process entrypoint, so `cli.test.ts` can import `runCli`
// without resolving a real credential or reading real stdin.
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const getRuntime = createRuntimeResolver();
  await main(process.argv.slice(2), {
    readStdin: readTokenFromStdin,
    persist: (token: string) => persistCredential(MAGENTO_GRAPHQL_DOMAIN, token),
    resolveToken: () => resolveOptionalCustomerToken(),
    probe: () => getRuntime().client.query("query Probe { storeConfig { store_code } }"),
  });
}
