// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The ONLY code in `packages/magento-rest` that talks to the network, and the
// only place a response status is read. Guarantees, each pinned by
// `http.test.ts`:
//
//   - the token travels only in the `Authorization` header, never in a URL;
//   - a failure becomes a classified `MagentoRestError` that carries neither
//     the response body nor any credential (`errors.ts`);
//   - a read (GET) is retried with backoff, a write (POST/PUT/DELETE) never
//     is — replaying `create_invoice` after an ambiguous failure could
//     capture a payment twice;
//   - the MCP request's signal aborts the in-flight request, and a cancelled
//     call is never retried;
//   - a store scope (`all` or a store code) sends the request to
//     `/rest/<scope>/V1`: a catalog or CMS write through the base URL's
//     default store view would change only that store view's values;
//   - a plaintext base URL is refused unless it is loopback: a Bearer sent
//     over http is a Bearer on the wire. TLS verification itself is never
//     switchable from here — there is no option that turns it off.
//
// `fetch`, `now` and `sleep` are injected, so no test waits on a real clock
// or reaches a real host.
import type { TokenProvider } from "@hiberus-magento/mcp-core";
import { MagentoRestError, classifyFailure } from "./errors.js";
import { REST_PACE, TokenBucketRateLimiter } from "./rate-limiter.js";
import { decideRetry } from "./retry.js";

export type RestMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RestRequest {
  readonly method: RestMethod;
  /** From `restPath`: starts with `/`, carries no `?` or `#`. */
  readonly path: string;
  /** From `buildSearchCriteria` or `URLSearchParams`, no leading `?`. */
  readonly query?: string;
  readonly body?: unknown;
  /** The MCP request's signal: when the client cancels the tool call, the in-flight request is aborted and not retried. */
  readonly signal?: AbortSignal;
  /**
   * Store scope: a store view code, or `all` for the global (admin) values every store view inherits. The request
   * goes to `/rest/<scope>/V1` instead of the base URL's own scope. Absent, the base URL is used as configured.
   */
  readonly scope?: string;
  /** Called once when Magento answers this request with a success, so a tool can say where and when its data came from. */
  readonly onAnswered?: (answer: RestAnswer) => void;
}

/** Where a successful answer came from, for a result's provenance. */
export interface RestAnswer {
  /** Method and path from `/rest` on: no host, no query string (it can carry data), no token. */
  readonly endpoint: string;
  /** ISO 8601 UTC, when Magento answered. */
  readonly readAt: string;
  /** The store view the request addressed, when the URL names one. */
  readonly storeView?: string;
}

export interface RestTransportDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Injectable so full-jitter backoff stays testable. */
  readonly random?: () => number;
  readonly baseUrl: string;
  readonly tokenProvider: TokenProvider;
  /** Per-attempt limit: Magento accepting the connection and never answering must not hang the tool call. */
  readonly timeoutMs?: number;
}

export interface RestTransport {
  request(request: RestRequest): Promise<unknown>;
}

/** Long enough for a slow admin listing, short enough that a stalled instance fails the call. */
export const DEFAULT_REST_TIMEOUT_MS = 30_000;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

function normalizeBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("The Magento base URL is not a valid URL (expected https://<host>/rest/V1).");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("The Magento base URL must not embed credentials; the token is sent as a Bearer header.");
  }
  const loopback = LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("The Magento base URL must use https (plain http is allowed only for localhost).");
  }
  return baseUrl.replace(/\/+$/, "");
}

/** `https://host/rest/V1` or `https://host/rest/<code>/V1` -> `https://host/rest`; anything else cannot be re-scoped. */
const SCOPED_BASE = /^(.*\/rest)(?:\/([A-Za-z0-9_]+))?\/V1$/;
const STORE_CODE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

function scopedBase(restRoot: string | undefined, scope: string): string {
  if (!STORE_CODE.test(scope)) {
    throw new Error(`A store scope must be a store code (letters, digits, underscores) or all; got ${JSON.stringify(scope.slice(0, 40))}.`);
  }
  if (restRoot === undefined) {
    throw new Error("A store-scoped request needs a base URL that ends in /rest/V1 or /rest/<store_code>/V1.");
  }
  return `${restRoot}/${scope}/V1`;
}

function assertPath(path: string): void {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error("A REST path must start with / and carry no query or fragment; build it with restPath().");
  }
}

function cancelled(cause?: unknown): MagentoRestError {
  return new MagentoRestError({ kind: "transport", message: "Magento REST request was cancelled by the client.", retryable: false, ...(cause !== undefined ? { cause } : {}) });
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (header === null || !/^\d+$/.test(header.trim())) {
    return undefined;
  }
  return Number(header.trim()) * 1000;
}

export function createRestTransport(deps: RestTransportDeps): RestTransport {
  const baseUrl = normalizeBaseUrl(deps.baseUrl);
  const scopedMatch = SCOPED_BASE.exec(baseUrl);
  const restRoot = scopedMatch?.[1];
  const baseStoreView = scopedMatch?.[2];
  const random = deps.random ?? Math.random;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_REST_TIMEOUT_MS;
  const rateLimiter = new TokenBucketRateLimiter(REST_PACE, { now: deps.now, sleep: deps.sleep });

  async function attemptOnce(request: RestRequest, root: string): Promise<{ readonly value: unknown } | { readonly failure: MagentoRestError; readonly retryAfterMs?: number }> {
    await rateLimiter.acquire();
    const credential = await deps.tokenProvider.getToken();
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${credential.value}` };
    const hasBody = request.body !== undefined;
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    let text: string;
    try {
      response = await deps.fetch(`${root}${request.path}${request.query !== undefined && request.query !== "" ? `?${request.query}` : ""}`, {
        method: request.method,
        headers,
        // A redirect would re-send the request somewhere the operator never
        // configured; surface it as a failure instead of following it.
        redirect: "manual",
        signal: request.signal !== undefined ? AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
      });
      // Inside the try: the timeout also covers a body that starts and then stalls.
      text = await response.text();
    } catch (cause) {
      if (request.signal?.aborted === true) {
        return { failure: cancelled(cause) };
      }
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      return {
        failure: new MagentoRestError({
          kind: "transport",
          message: timedOut ? `Magento REST request timed out after ${Math.round(timeoutMs / 1000)} s without a response.` : "Magento REST request failed before a response was received.",
          retryable: true,
          cause,
        }),
      };
    }

    if (!response.ok) {
      const after = retryAfterMs(response);
      return { failure: classifyFailure(response.status, text), ...(after !== undefined ? { retryAfterMs: after } : {}) };
    }
    if (text === "") {
      return { value: undefined };
    }
    try {
      return { value: JSON.parse(text) as unknown };
    } catch {
      return {
        failure: new MagentoRestError({ kind: "unparseable", message: "Magento REST returned a success status with a body that is not JSON.", status: response.status }),
      };
    }
  }

  function answerFor(request: RestRequest, root: string): RestAnswer {
    const pathname = new URL(`${root}${request.path}`).pathname;
    const fromRest = pathname.indexOf("/rest/");
    // `all` is the global (admin) scope, not a store view.
    const scope = request.scope ?? baseStoreView;
    const storeView = scope === "all" ? undefined : scope;
    return {
      endpoint: `${request.method} ${fromRest >= 0 ? pathname.slice(fromRest) : pathname}`,
      readAt: new Date(deps.now()).toISOString(),
      ...(storeView !== undefined ? { storeView } : {}),
    };
  }

  return {
    async request(request: RestRequest): Promise<unknown> {
      assertPath(request.path);
      const root = request.scope !== undefined ? scopedBase(restRoot, request.scope) : baseUrl;
      const idempotent = request.method === "GET";
      for (let attempt = 1; ; attempt += 1) {
        // Checked before every attempt: a call cancelled during a backoff sleep sends nothing more.
        if (request.signal?.aborted === true) {
          throw cancelled();
        }
        const outcome = await attemptOnce(request, root);
        if ("value" in outcome) {
          request.onAnswered?.(answerFor(request, root));
          return outcome.value;
        }
        const decision = decideRetry(
          { retryable: outcome.failure.retryable, idempotent, ...(outcome.retryAfterMs !== undefined ? { retryAfterMs: outcome.retryAfterMs } : {}) },
          attempt,
          random,
        );
        if (!decision.retry) {
          throw outcome.failure;
        }
        await deps.sleep(decision.delayMs);
      }
    },
  };
}
