// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The ONLY place a failure becomes an error. GraphQL fails two ways: an HTTP status (a proxy, a
// WAF, a rate limit) and HTTP 200 with an `errors` array. Both end here, and only Magento's
// message survives: `extensions`, `locations` and `path` are dropped, a non-JSON body is never
// surfaced (a proxy's HTML page can name an internal host), and what is kept goes through `redact`.
import { redact } from "@hiberus-magento/mcp-core";

export type MagentoGraphqlErrorKind = "unauthorized" | "forbidden" | "not-found" | "invalid-request" | "rate-limited" | "server" | "transport" | "unparseable";

const MAX_MESSAGE_CHARS = 240;
const MAX_MESSAGES = 5;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

export interface MagentoGraphqlErrorInit {
  readonly kind: MagentoGraphqlErrorKind;
  readonly message: string;
  readonly status?: number;
  readonly retryable?: boolean;
  readonly remedy?: string;
  readonly cause?: unknown;
}

export class MagentoGraphqlError extends Error {
  readonly kind: MagentoGraphqlErrorKind;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly remedy: string | undefined;

  constructor(init: MagentoGraphqlErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "MagentoGraphqlError";
    this.kind = init.kind;
    this.status = init.status;
    this.retryable = init.retryable ?? false;
    this.remedy = init.remedy;
  }
}

const UNAUTHORIZED_REMEDY =
  "The operation needs a signed-in customer (or the customer token has expired). Obtain a customer token outside this server " +
  "(the generateCustomerToken mutation), then set MAGENTO_GRAPHQL_TOKEN or run `hiberus-magento-graphql auth token set`. " +
  "Anonymous calls only reach the public storefront schema.";

// Magento itself answers an authorization failure with HTTP 200 and an `errors` entry, so a 403 comes from
// something in front of it (a firewall, a WAF) or from a store that reports failures by status. Say both, and
// point at the one thing the operator controls here.
const FORBIDDEN_REMEDY =
  "Magento reports authorization problems inside a 200 response, so a 403 usually comes from something in front of it (a firewall or WAF) or from a store that answers by status. " +
  "If the operation was a customer one, check the customer token first (MAGENTO_GRAPHQL_TOKEN or `hiberus-magento-graphql auth token set`).";

function kindForStatus(status: number): MagentoGraphqlErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server";
  return "invalid-request";
}

function jsonMessage(bodyText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed !== null && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string" && parsed.message !== "") {
      return parsed.message;
    }
  } catch {
    // Not JSON: nothing of it is surfaced.
  }
  return undefined;
}

export function classifyHttpFailure(status: number, bodyText: string): MagentoGraphqlError {
  const kind = kindForStatus(status);
  const template = jsonMessage(bodyText);
  return new MagentoGraphqlError({
    kind,
    message: template === undefined ? `Magento GraphQL request failed with HTTP ${status}.` : `Magento GraphQL HTTP ${status}: ${redact(template).slice(0, MAX_MESSAGE_CHARS)}`,
    status,
    retryable: RETRYABLE_STATUSES.has(status),
    ...(kind === "unauthorized" ? { remedy: UNAUTHORIZED_REMEDY } : kind === "forbidden" ? { remedy: FORBIDDEN_REMEDY } : {}),
  });
}

interface RawGraphqlError {
  readonly message?: unknown;
  readonly extensions?: { readonly category?: unknown } | null;
}

function categoryOf(entry: unknown): string | undefined {
  const category = (entry as RawGraphqlError | null)?.extensions?.category;
  return typeof category === "string" ? category : undefined;
}

/** The GraphQL `errors` array of a response as one error. Takes `unknown` entries: the server is not trusted to shape them. */
export function classifyGraphqlErrors(errors: readonly unknown[]): MagentoGraphqlError {
  const messages = errors
    .map((entry) => ((entry as RawGraphqlError | null)?.message))
    .filter((message): message is string => typeof message === "string" && message !== "")
    .map((message) => redact(message).slice(0, MAX_MESSAGE_CHARS));
  const shown = messages.slice(0, MAX_MESSAGES);
  const extra = messages.length - shown.length;
  const categories = errors.map(categoryOf);
  const kind: MagentoGraphqlErrorKind = categories.some((c) => c === "graphql-authorization" || c === "graphql-authentication")
    ? "unauthorized"
    : categories.some((c) => c === "graphql-no-such-entity")
      ? "not-found"
      : "invalid-request";
  return new MagentoGraphqlError({
    kind,
    message: shown.length === 0 ? "Magento GraphQL returned an error without a message." : `Magento GraphQL: ${shown.join(" | ")}${extra > 0 ? ` (+${extra} more)` : ""}`,
    ...(kind === "unauthorized" ? { remedy: UNAUTHORIZED_REMEDY } : {}),
  });
}
