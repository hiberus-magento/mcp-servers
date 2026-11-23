// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The typed error every failed call carries (Kora contract R-8), as `structuredContent: { error }` next to the
// prose an agent reads. A host acts on `code` and the member that code needs, never on the prose:
//
//   unauthorized         401 (or a missing credential): the token is wrong, expired or refused
//   permission_missing   401/403 naming an ACL resource the integration lacks       resource
//   rate_limited         429                                                         retry_after_ms
//   timeout              Magento did not answer within the per-attempt limit
//   unavailable          network, DNS, 5xx, maintenance                              http_status when there was one
//   invalid_argument     an argument this server rejects (MAGENTO_REST_BASE_URL on a redirect)  argument
//   not_found            a record a write needs does not exist (R-24)                argument
//   upstream_error       any other Magento failure                                   http_status
//
// `message` repeats the prose (Magento's message, redacted, and the remedy); a host need not show it.
import { redact } from "@hiberus-magento/mcp-core";
import { ZodError } from "zod";
import { MagentoRestError } from "../client/index.js";
import { DatabaseConfigError } from "../db/connection.js";
import { SqlGuardError } from "../db/sql-guard.js";

/** What `retry_after_ms` says when a 429 carried no usable Retry-After: this server's own backoff cap. */
export const DEFAULT_RETRY_AFTER_MS = 4000;

export type ToolErrorCode = "unauthorized" | "permission_missing" | "rate_limited" | "timeout" | "unavailable" | "invalid_argument" | "not_found" | "upstream_error";

export interface ToolErrorBody {
  readonly code: ToolErrorCode;
  readonly message?: string;
  readonly resource?: string;
  readonly retry_after_ms?: number;
  readonly http_status?: number;
  readonly argument?: string;
}

/** An argument this server rejects before or after asking Magento: `invalid_argument`, or `not_found` for a record a write needs. */
export class ToolArgumentError extends Error {
  readonly code: "invalid_argument" | "not_found";
  readonly argument: string;

  constructor(code: "invalid_argument" | "not_found", argument: string, message: string) {
    super(message);
    this.name = "ToolArgumentError";
    this.code = code;
    this.argument = argument;
  }
}

function forMagento(error: MagentoRestError): ToolErrorBody {
  const status = error.status !== undefined ? { http_status: error.status } : {};
  switch (error.kind) {
    case "unauthorized":
    case "forbidden":
      if (error.resources !== undefined) return { code: "permission_missing", resource: error.resources, ...status };
      return error.kind === "unauthorized" ? { code: "unauthorized", ...status } : { code: "upstream_error", ...status };
    case "rate-limited":
      return { code: "rate_limited", retry_after_ms: error.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, ...status };
    case "transport":
      return error.timedOut === true ? { code: "timeout" } : { code: "unavailable" };
    case "server":
      return { code: "unavailable", ...status };
    case "redirected":
      // The store answers at another address: the base URL is the argument to change.
      return { code: "invalid_argument", argument: "MAGENTO_REST_BASE_URL", ...status };
    default:
      return { code: "upstream_error", ...status };
  }
}

/** The typed error for a thrown value, without its message. */
function bodyWithoutMessage(error: unknown): ToolErrorBody {
  if (error instanceof ToolArgumentError) return { code: error.code, argument: error.argument };
  if (error instanceof MagentoRestError) return forMagento(error);
  if (error instanceof ZodError) {
    const first = error.issues[0];
    // An input the schema does not know is named by its key, not by the object that holds it.
    const path = first === undefined ? [] : first.code === "unrecognized_keys" ? [...first.path, ...first.keys.slice(0, 1).map((key) => key.slice(0, 64))] : first.path;
    return { code: "invalid_argument", argument: path.length > 0 ? path.map(String).join(".") : "arguments" };
  }
  if (error instanceof SqlGuardError) return { code: "invalid_argument", argument: "sql" };
  if (error instanceof DatabaseConfigError) return { code: "unavailable" };
  return { code: "upstream_error" };
}

/** The typed error for a thrown value, carrying `message` (redacted) when the caller has none of its own to give. */
export function errorBodyFor(error: unknown, message?: string): ToolErrorBody {
  const text = message ?? (error instanceof Error ? redact(error.message) : undefined);
  return { ...bodyWithoutMessage(error), ...(text !== undefined ? { message: text } : {}) };
}

/** Arguments that bound how much a call returns, in the order a caller should reach for them. */
const SIZE_ARGUMENTS = ["page_size", "max_pages", "max_rows"] as const;

/**
 * The typed error for an error `invoke` answered itself: a missing or unusable credential is `unauthorized`; a result
 * over the output cap is `invalid_argument` on the tool's own size argument (or `arguments` when it has none);
 * anything else is `upstream_error`.
 */
export function invokeErrorBody(result: { readonly content: readonly { readonly text: string }[]; readonly errorKind?: "credential" | "too_large" }, tool: { readonly inputSchema: { readonly shape: Record<string, unknown> } }): ToolErrorBody {
  const message = result.content[0]?.text;
  const withMessage = message !== undefined ? { message } : {};
  if (result.errorKind === "too_large") {
    const argument = SIZE_ARGUMENTS.find((name) => Object.hasOwn(tool.inputSchema.shape, name)) ?? "arguments";
    return { code: "invalid_argument", argument, ...withMessage };
  }
  if (result.errorKind === "credential") return { code: "unauthorized", ...withMessage };
  return { code: "upstream_error", ...withMessage };
}
