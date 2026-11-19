// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The adapter layer's environment reads and error rendering — the ONLY place
// in this package that touches `process.env` (the client is pure and is
// handed everything it needs).
//
// Resolved LAZILY, on the first tool CALL rather than at startup, so
// `tools/list` keeps working before the base URL is set. A missing base URL
// is a configuration error, not a credential error, so it is a plain Error
// naming the variable (the same precedent as `eds`'s `EDS_ORG` and `aco`'s
// base URLs).
import { readFileSync, statSync } from "node:fs";
import { redact } from "@hiberus-magento/mcp-core";
import { ZodError } from "zod";
import { DatabaseError } from "../db/access.js";
import { DATABASE_ALLOW_WRITES_ENV_VAR, DATABASE_CONNECTION_ENV_VAR, DatabaseConfigError, parseDatabaseConnection, type DatabaseTarget } from "../db/connection.js";
import { SqlGuardError } from "../db/sql-guard.js";
import { MagentoRestError, createMagentoRestClient, type MagentoRestClient } from "../client/index.js";
import { createMagentoTokenProvider } from "../credential-provider.js";
import { parseGroups } from "./index.js";
import { FieldConfigError, applyFieldConfig, parseFieldConfig, type FieldConfig } from "./field-config.js";
import { BASE_SHAPES } from "./shapes.js";

export const BASE_URL_ENV_VAR = "MAGENTO_REST_BASE_URL";
export const ALLOW_WRITES_ENV_VAR = "MAGENTO_REST_ALLOW_WRITES";
export const FIELDS_FILE_ENV_VAR = "MAGENTO_REST_FIELDS_FILE";
export const GROUPS_ENV_VAR = "MAGENTO_REST_GROUPS";

export interface MagentoRestRuntime {
  readonly client: MagentoRestClient;
}

export function createRuntimeResolver(): () => MagentoRestRuntime {
  let runtime: MagentoRestRuntime | undefined;
  return () => {
    if (runtime !== undefined) {
      return runtime;
    }
    const baseUrl = process.env[BASE_URL_ENV_VAR];
    if (baseUrl === undefined || baseUrl.length === 0) {
      throw new Error(`${BASE_URL_ENV_VAR} is required: the Magento REST root, e.g. https://<host>/rest/V1. Set it and restart.`);
    }
    // Built (and its base URL validated) before it is stored, so a bad URL is
    // reported again on the next call instead of being cached as a half-built runtime.
    const client = createMagentoRestClient({
      fetch: globalThis.fetch,
      now: () => Date.now(),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      baseUrl,
      tokenProvider: createMagentoTokenProvider(),
    });
    runtime = { client };
    return runtime;
  };
}

/**
 * Whether write tools are registered at all. Only the exact string `true`
 * enables them: `1`, `yes` and `TRUE` do not, so a half-remembered value
 * fails closed rather than open. Read once at startup — a server that is
 * read-only when it starts cannot be talked into writing by a later call.
 */
export function writesEnabled(): boolean {
  return process.env[ALLOW_WRITES_ENV_VAR] === "true";
}

/**
 * The tool groups the operator chose with `MAGENTO_REST_GROUPS`, read once at startup. Unset or blank means
 * every group. An unknown name is an error naming the variable and the valid groups, never skipped: a typo
 * must not start a server with a tool set the operator did not ask for.
 */
export function readGroupsFromEnv(): readonly string[] {
  try {
    return parseGroups(process.env[GROUPS_ENV_VAR]);
  } catch (error) {
    throw new Error(`${GROUPS_ENV_VAR}: ${error instanceof Error ? error.message : "invalid"}`, { cause: error });
  }
}

export interface DatabaseSettings {
  readonly target: DatabaseTarget;
  readonly writesEnabled: boolean;
}

/**
 * The database the operator pointed the server at, read once at startup. No connection variable means no
 * database (and no database tools). A connection string that does not validate is an error naming the variable —
 * and the string is never echoed, because a malformed one may still hold a password. The password is NOT read
 * here: like the REST token it is resolved on each use, so a missing one is a tool error with the fix in it,
 * not a server that will not start.
 *
 * `MAGENTO_REST_DATABASE_ALLOW_WRITES` follows the same rule as the REST write switch (only the exact string
 * `true`), and without a connection it is an error: a switch that does nothing is worse than none, because the
 * operator would believe writes were set up.
 */
export function readDatabaseSettingsFromEnv(): DatabaseSettings | undefined {
  const connection = process.env[DATABASE_CONNECTION_ENV_VAR];
  const writes = process.env[DATABASE_ALLOW_WRITES_ENV_VAR] === "true";
  if (connection === undefined || connection === "") {
    if (writes) {
      throw new DatabaseConfigError(`${DATABASE_ALLOW_WRITES_ENV_VAR} is set but ${DATABASE_CONNECTION_ENV_VAR} is not: there is no database to write to. Set the connection, or unset the switch.`);
    }
    return undefined;
  }
  return { target: parseDatabaseConnection(connection), writesEnabled: writes };
}

export interface ErrorResult {
  readonly isError: true;
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
}

function errorResult(text: string): ErrorResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Renders a thrown error as an MCP error result. `defineTool.invoke` has already handled the credential errors. */
export function toErrorResult(error: unknown): ErrorResult {
  if (error instanceof MagentoRestError) {
    return errorResult(error.remedy !== undefined ? `${error.message}\nRemedy: ${error.remedy}` : error.message);
  }
  if (error instanceof SqlGuardError || error instanceof DatabaseError || error instanceof DatabaseConfigError) {
    return errorResult(redact(error.message));
  }
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`);
    return errorResult(`Invalid arguments: ${issues.join("; ")}`);
  }
  return errorResult(`Unexpected error: ${error instanceof Error ? redact(error.message) : "unknown failure"}`);
}

const MAX_FIELDS_FILE_BYTES = 64 * 1024;

/**
 * The operator's field additions, from the file `MAGENTO_REST_FIELDS_FILE`
 * names — read once, at startup. No variable means no additions. A file that
 * cannot be read or does not validate is an error, never a fallback: starting
 * with fewer fields than the operator asked for is a worse failure than not
 * starting, because nothing says the configuration did not apply.
 */
export function readFieldConfigFromEnv(): FieldConfig {
  const path = process.env[FIELDS_FILE_ENV_VAR];
  if (path === undefined || path === "") {
    return {};
  }
  let text: string;
  try {
    if (statSync(path).size > MAX_FIELDS_FILE_BYTES) {
      throw new FieldConfigError(`${FIELDS_FILE_ENV_VAR}: ${path} is larger than 64 KB; a field configuration is a short list, not a data file`);
    }
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof FieldConfigError) {
      throw error;
    }
    throw new FieldConfigError(`${FIELDS_FILE_ENV_VAR}: cannot read ${path}: ${error instanceof Error ? error.message : "unknown failure"}`);
  }
  try {
    const config = parseFieldConfig(text);
    // A dry run against the shipped lists, so a removal of a field that is not there stops the server
    // now, with the file named, instead of surfacing later in whichever module first builds its shapes.
    applyFieldConfig(BASE_SHAPES, config);
    return config;
  } catch (error) {
    throw new FieldConfigError(`${FIELDS_FILE_ENV_VAR} (${path}): ${error instanceof Error ? error.message : "invalid"}`);
  }
}
