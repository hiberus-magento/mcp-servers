// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The adapter layer's environment reads and error rendering — the ONLY place in this package that
// touches `process.env` (the client is pure and is handed everything it needs).
//
// Resolved LAZILY, on the first tool CALL rather than at startup, so `tools/list` keeps working
// before the base URL is set. A missing base URL is a configuration error, not a credential
// error, so it is a plain Error naming the variable.
import { redact } from "@hiberus-magento/mcp-core";
import { ZodError } from "zod";
import { MagentoGraphqlError, OperationGuardError, createMagentoGraphqlClient, type MagentoGraphqlClient } from "../client/index.js";
import { resolveOptionalCustomerToken } from "../credential-provider.js";
import { parseGroups } from "./index.js";

export const BASE_URL_ENV_VAR = "MAGENTO_GRAPHQL_BASE_URL";
export const STORE_ENV_VAR = "MAGENTO_GRAPHQL_STORE";
export const ALLOW_WRITES_ENV_VAR = "MAGENTO_GRAPHQL_ALLOW_WRITES";
export const GROUPS_ENV_VAR = "MAGENTO_GRAPHQL_GROUPS";

export interface MagentoGraphqlRuntime {
  readonly client: MagentoGraphqlClient;
}

export function createRuntimeResolver(): () => MagentoGraphqlRuntime {
  let runtime: MagentoGraphqlRuntime | undefined;
  return () => {
    if (runtime !== undefined) {
      return runtime;
    }
    const baseUrl = process.env[BASE_URL_ENV_VAR];
    if (baseUrl === undefined || baseUrl.length === 0) {
      throw new Error(`${BASE_URL_ENV_VAR} is required: the Magento GraphQL endpoint, e.g. https://<host>/graphql. Set it and restart.`);
    }
    const store = process.env[STORE_ENV_VAR];
    if (store !== undefined && store !== "" && !/^[a-z0-9_]{1,32}$/.test(store)) {
      throw new Error(`${STORE_ENV_VAR} must be a store view code: 1-32 characters of a-z, 0-9 and underscore.`);
    }
    // Built (and its base URL validated) before it is stored, so a bad URL is reported again on the
    // next call instead of being cached as a half-built runtime.
    const client = createMagentoGraphqlClient({
      fetch: globalThis.fetch,
      now: () => Date.now(),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      baseUrl,
      // On every attempt, never cached: a token stored while the server runs applies on the next call.
      getToken: async () => resolveOptionalCustomerToken(),
      ...(store !== undefined && store !== "" ? { defaultStore: store } : {}),
    });
    runtime = { client };
    return runtime;
  };
}

/**
 * Whether write tools are registered at all. Only the exact string `true` enables them: `1`, `yes`
 * and `TRUE` do not, so a half-remembered value fails closed. Read once at startup — a server that
 * is read-only when it starts cannot be talked into writing by a later call.
 */
export function writesEnabled(): boolean {
  return process.env[ALLOW_WRITES_ENV_VAR] === "true";
}

/** The groups chosen with `MAGENTO_GRAPHQL_GROUPS`, read once. An unknown name is an error naming the variable, never skipped. */
export function readGroupsFromEnv(): readonly string[] {
  try {
    return parseGroups(process.env[GROUPS_ENV_VAR]);
  } catch (error) {
    throw new Error(`${GROUPS_ENV_VAR}: ${error instanceof Error ? error.message : "invalid"}`, { cause: error });
  }
}

export interface ErrorResult {
  readonly isError: true;
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
}

const errorResult = (text: string): ErrorResult => ({ isError: true, content: [{ type: "text", text }] });

/** Renders a thrown error as an MCP error result. `defineTool.invoke` has already handled a missing credential. */
export function toErrorResult(error: unknown): ErrorResult {
  if (error instanceof MagentoGraphqlError) {
    return errorResult(error.remedy !== undefined ? `${error.message}\nRemedy: ${error.remedy}` : error.message);
  }
  if (error instanceof OperationGuardError) {
    return errorResult(error.message);
  }
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`);
    return errorResult(`Invalid arguments: ${issues.join("; ")}`);
  }
  return errorResult(`Unexpected error: ${error instanceof Error ? redact(error.message) : "unknown failure"}`);
}
