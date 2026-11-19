// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The ONLY place an HTTP failure becomes an error. Magento's error body is
// `{ message, parameters }` where `message` is a TEMPLATE with `%1` /
// `%fieldName` placeholders and `parameters` carries the substituted VALUES —
// an email, an order id, a SKU. Only the template is kept; `parameters` and
// any non-JSON body (a proxy's HTML page can name an internal host) are
// dropped by construction, and what remains still goes through `redact`.
import { redact } from "@hiberus-magento/mcp-core";

export type MagentoRestErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "invalid-request"
  | "rate-limited"
  | "server"
  | "transport"
  | "unparseable";

const MAX_MESSAGE_CHARS = 240;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

export interface MagentoRestErrorInit {
  readonly kind: MagentoRestErrorKind;
  readonly message: string;
  readonly status?: number;
  readonly retryable?: boolean;
  readonly remedy?: string;
  readonly cause?: unknown;
}

export class MagentoRestError extends Error {
  readonly kind: MagentoRestErrorKind;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly remedy: string | undefined;

  constructor(init: MagentoRestErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "MagentoRestError";
    this.kind = init.kind;
    this.status = init.status;
    this.retryable = init.retryable ?? false;
    this.remedy = init.remedy;
  }
}

function kindForStatus(status: number): MagentoRestErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server";
  return "invalid-request";
}

function remedyForKind(kind: MagentoRestErrorKind): string | undefined {
  if (kind === "unauthorized") {
    // Magento answers 401 for ALL of these with the same text, so the remedy
    // says so instead of blaming the token alone (observed against a live
    // 2.4.8: a token with no matching permission is a 401, not a 403).
    return (
      "Magento answers 401 both for a bad token and for a token whose integration lacks the resource named above. Check that the integration is Active, " +
      "that the stored value is its Access Token (not the Consumer Key), and that its Resource Access includes that resource. " +
      "Since Magento 2.4.4 an integration token is also refused as a Bearer unless Stores > Configuration > Services > OAuth > Consumer Settings > " +
      '"Allow OAuth Access Tokens to be used as standalone Bearer tokens" is Yes. ' +
      "Then set MAGENTO_REST_TOKEN or run `hiberus-magento-rest auth token set`."
    );
  }
  if (kind === "not-found") {
    // Observed live: on a LIST endpoint Magento answers 404 for the whole page when ONE of the
    // records it loads references something that no longer exists (a cart whose customer was
    // deleted). The same 404 is what a single missing record gets, so say both.
    return (
      "Magento answers 404 both for a record that does not exist and, on a list, when one record in the requested page references something that no longer exists. " +
      "If this was a list, try a smaller page_size or a narrower filter to step past the broken record."
    );
  }
  if (kind === "forbidden") {
    return "The token is valid but its role lacks the ACL resource this endpoint needs — grant the resource to the integration in Magento's admin.";
  }
  return undefined;
}

/** Magento's message template, or `undefined` when the body has none (not JSON, no string `message`). */
function extractTemplate(bodyText: string): string | undefined {
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

// ACL resource ids look like `Magento_Backend::store`. Magento's own 401 names
// the one the route needs in `parameters.resources` (several are joined with
// ", "). That is configuration, not customer data, and it is exactly what an
// operator needs to see which permission the integration lacks — so it is the
// ONE parameter kept, only on 401/403, and only when it matches this closed
// shape. Anything else in `parameters` is still dropped.
const ACL_RESOURCES_PATTERN = /^[A-Za-z0-9_]+::[A-Za-z0-9_]+(?:, [A-Za-z0-9_]+::[A-Za-z0-9_]+)*$/;
const MAX_ACL_RESOURCES_CHARS = 200;

function extractAclResources(status: number, bodyText: string): string | undefined {
  if (status !== 401 && status !== 403) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed !== null && typeof parsed === "object" && "parameters" in parsed && parsed.parameters !== null && typeof parsed.parameters === "object" && "resources" in parsed.parameters) {
      const resources = parsed.parameters.resources;
      if (typeof resources === "string" && resources.length <= MAX_ACL_RESOURCES_CHARS && ACL_RESOURCES_PATTERN.test(resources)) {
        return resources;
      }
    }
  } catch {
    // Not JSON: nothing of it is surfaced.
  }
  return undefined;
}

export function classifyFailure(status: number, bodyText: string): MagentoRestError {
  const kind = kindForStatus(status);
  const template = extractTemplate(bodyText);
  const resources = extractAclResources(status, bodyText);
  const message =
    template === undefined
      ? `Magento REST request failed with HTTP ${status}.`
      : `Magento REST HTTP ${status}: ${redact(template).slice(0, MAX_MESSAGE_CHARS)}${resources !== undefined ? ` (resource: ${resources})` : ""}`;
  const remedy = remedyForKind(kind);
  return new MagentoRestError({
    kind,
    message,
    status,
    retryable: RETRYABLE_STATUSES.has(status),
    ...(remedy !== undefined ? { remedy } : {}),
  });
}
