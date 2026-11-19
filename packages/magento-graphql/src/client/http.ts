// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The ONLY code in `packages/magento-graphql` that talks to the network. Guarantees, each pinned
// by `http.test.ts`:
//
//   - the customer token travels only in the `Authorization` header, never in a URL or body, and
//     only when there is one: no token means an anonymous storefront call;
//   - a failure becomes a classified `MagentoGraphqlError` carrying neither the response body nor
//     a credential (`errors.ts`);
//   - a query is retried with backoff, a mutation never is — replaying `addProductsToCart` after
//     an ambiguous failure could add the same item twice;
//   - a plaintext base URL is refused unless it is loopback, and TLS verification is not switchable;
//   - every attempt is aborted after a bounded time (30 s by default), body included, and reported as a timeout;
//   - a resolver that failed is an error, not data: Magento answers it with HTTP 200, the field `null` in `data`
//     and the reason in `errors`, so `errors` next to a `data` whose fields are all `null` is a failure.
//
// `fetch`, `now`, `sleep`, the timeout and the token source are injected, so no test waits on a real clock or
// reaches a real host.
import { MagentoGraphqlError, classifyGraphqlErrors, classifyHttpFailure, graphqlErrorMessages } from "./errors.js";
import { GRAPHQL_PACE, TokenBucketRateLimiter } from "./rate-limiter.js";
import { decideRetry } from "./retry.js";

export interface GraphqlRequest {
  /** What the document is. The client has already checked it against the document; here it only decides retrying. */
  readonly kind: "query" | "mutation";
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  /** Store view code, sent as the `Store` header; overrides the transport's default. */
  readonly store?: string;
  /** ISO 4217 code, sent as `Content-Currency`. */
  readonly currency?: string;
}

export interface GraphqlResult {
  readonly data: unknown;
  /** Messages Magento reported alongside partial data; absent when there were none. */
  readonly errors?: readonly string[];
}

export interface GraphqlTransportDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Injectable so full-jitter backoff stays testable. */
  readonly random?: () => number;
  readonly baseUrl: string;
  /** The customer token, or `undefined` for an anonymous call. Called on every attempt. */
  readonly getToken: () => Promise<string | undefined>;
  readonly defaultStore?: string;
  /** How long one attempt may take, response body included, before it is aborted. Defaults to `DEFAULT_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

export interface GraphqlTransport {
  execute(request: GraphqlRequest): Promise<GraphqlResult>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
const STORE_PATTERN = /^[a-z0-9_]{1,32}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function validateBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("The Magento base URL is not a valid URL (expected https://<host>/graphql).");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("The Magento base URL must not embed credentials; a customer token is sent as a Bearer header.");
  }
  const loopback = LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("The Magento base URL must use https (plain http is allowed only for localhost).");
  }
  return baseUrl;
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  return header !== null && /^\d+$/.test(header.trim()) ? Number(header.trim()) * 1000 : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** What `fetch` (or a body read) rejects with when an `AbortSignal.timeout` fires. */
function isTimeout(cause: unknown): boolean {
  return isRecord(cause) && cause["name"] === "TimeoutError";
}

/** Whether Magento reported errors and had nothing to show for them: `data` empty, or every field of it `null`. */
function allFieldsNull(data: Record<string, unknown>): boolean {
  return Object.values(data).every((value) => value === null);
}

export function createGraphqlTransport(deps: GraphqlTransportDeps): GraphqlTransport {
  const baseUrl = validateBaseUrl(deps.baseUrl);
  const random = deps.random ?? Math.random;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const rateLimiter = new TokenBucketRateLimiter(GRAPHQL_PACE, { now: deps.now, sleep: deps.sleep });

  async function attemptOnce(request: GraphqlRequest, headers: Record<string, string>): Promise<{ readonly value: GraphqlResult } | { readonly failure: MagentoGraphqlError; readonly retryAfterMs?: number }> {
    await rateLimiter.acquire();
    const token = await deps.getToken();
    const sent = token !== undefined && token !== "" ? { ...headers, Authorization: `Bearer ${token}` } : headers;
    let response: Response;
    let text: string;
    try {
      response = await deps.fetch(baseUrl, {
        method: "POST",
        headers: sent,
        // A redirect would re-send the request (and the token) somewhere the operator never configured.
        redirect: "manual",
        body: JSON.stringify({ query: request.document, ...(request.variables !== undefined ? { variables: request.variables } : {}) }),
        // A fresh signal per attempt: a retry must get the whole budget again. It also aborts the body read below.
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await response.text();
    } catch (cause) {
      const message = isTimeout(cause)
        ? `Magento GraphQL request timed out after ${timeoutMs / 1000} seconds.`
        : "Magento GraphQL request failed before a response was received.";
      return { failure: new MagentoGraphqlError({ kind: "transport", message, retryable: true, cause }) };
    }
    if (!response.ok || (response.status >= 300 && response.status < 400)) {
      const after = retryAfterMs(response);
      return { failure: classifyHttpFailure(response.status, text), ...(after !== undefined ? { retryAfterMs: after } : {}) };
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { failure: new MagentoGraphqlError({ kind: "unparseable", message: "Magento GraphQL returned a success status with a body that is not JSON.", status: response.status }) };
    }
    const errors = isRecord(body) && Array.isArray(body["errors"]) ? (body["errors"] as readonly unknown[]) : [];
    const data = isRecord(body) ? body["data"] : undefined;
    const hasData = data !== undefined && data !== null;
    if (errors.length > 0 && (!hasData || (isRecord(data) && allFieldsNull(data)))) {
      return { failure: classifyGraphqlErrors(errors) };
    }
    if (!isRecord(body) || !hasData) {
      return { failure: new MagentoGraphqlError({ kind: "unparseable", message: "Magento GraphQL returned JSON with neither data nor errors.", status: response.status }) };
    }
    if (errors.length > 0) {
      // Partial data: at least one field resolved. Each message is kept whole, with the same redaction and caps.
      const { shown, extra } = graphqlErrorMessages(errors);
      return { value: { data: body["data"], errors: extra > 0 ? [...shown, `(+${extra} more)`] : shown } };
    }
    return { value: { data: body["data"] } };
  }

  return {
    async execute(request: GraphqlRequest): Promise<GraphqlResult> {
      const store = request.store ?? deps.defaultStore;
      if (store !== undefined && !STORE_PATTERN.test(store)) {
        throw new Error("The store view code must be 1-32 characters of a-z, 0-9 and underscore.");
      }
      if (request.currency !== undefined && !CURRENCY_PATTERN.test(request.currency)) {
        throw new Error("The currency must be a three-letter ISO 4217 code in upper case, e.g. EUR.");
      }
      const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
      if (store !== undefined) headers["Store"] = store;
      if (request.currency !== undefined) headers["Content-Currency"] = request.currency;
      const idempotent = request.kind === "query";
      for (let attempt = 1; ; attempt += 1) {
        const outcome = await attemptOnce(request, headers);
        if ("value" in outcome) {
          return outcome.value;
        }
        const decision = decideRetry({ retryable: outcome.failure.retryable, idempotent, ...(outcome.retryAfterMs !== undefined ? { retryAfterMs: outcome.retryAfterMs } : {}) }, attempt, random);
        if (!decision.retry) {
          throw outcome.failure;
        }
        await deps.sleep(decision.delayMs);
      }
    },
  };
}
