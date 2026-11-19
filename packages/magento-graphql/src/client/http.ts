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
//   - a plaintext base URL is refused unless it is loopback, and TLS verification is not switchable.
//
// `fetch`, `now`, `sleep` and the token source are injected, so no test waits on a real clock or
// reaches a real host.
import { MagentoGraphqlError, classifyGraphqlErrors, classifyHttpFailure } from "./errors.js";
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
}

export interface GraphqlTransport {
  execute(request: GraphqlRequest): Promise<GraphqlResult>;
}

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

export function createGraphqlTransport(deps: GraphqlTransportDeps): GraphqlTransport {
  const baseUrl = validateBaseUrl(deps.baseUrl);
  const random = deps.random ?? Math.random;
  const rateLimiter = new TokenBucketRateLimiter(GRAPHQL_PACE, { now: deps.now, sleep: deps.sleep });

  async function attemptOnce(request: GraphqlRequest, headers: Record<string, string>): Promise<{ readonly value: GraphqlResult } | { readonly failure: MagentoGraphqlError; readonly retryAfterMs?: number }> {
    await rateLimiter.acquire();
    const token = await deps.getToken();
    const sent = token !== undefined && token !== "" ? { ...headers, Authorization: `Bearer ${token}` } : headers;
    let response: Response;
    try {
      response = await deps.fetch(baseUrl, {
        method: "POST",
        headers: sent,
        // A redirect would re-send the request (and the token) somewhere the operator never configured.
        redirect: "manual",
        body: JSON.stringify({ query: request.document, ...(request.variables !== undefined ? { variables: request.variables } : {}) }),
      });
    } catch (cause) {
      return { failure: new MagentoGraphqlError({ kind: "transport", message: "Magento GraphQL request failed before a response was received.", retryable: true, cause }) };
    }
    const text = await response.text();
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
    const hasData = isRecord(body) && body["data"] !== undefined && body["data"] !== null;
    if (errors.length > 0 && !hasData) {
      return { failure: classifyGraphqlErrors(errors) };
    }
    if (!isRecord(body) || !hasData) {
      return { failure: new MagentoGraphqlError({ kind: "unparseable", message: "Magento GraphQL returned JSON with neither data nor errors.", status: response.status }) };
    }
    if (errors.length > 0) {
      // Partial data: the messages are classified only to get the same redaction and caps.
      const messages = classifyGraphqlErrors(errors).message.replace(/^Magento GraphQL: /, "").split(" | ");
      return { value: { data: body["data"], errors: messages } };
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
