// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The single request-building boundary (design.md, Decision 2 & 4): attaches
// the `X-Auth-Token` header (never `Authorization: token <key>` — see
// design.md, Decision 4, for why that shape defeats mcp-core's own
// redaction), awaits the rate limiter, and is `mapThrottle`'s only caller
// (design.md, Decision 3). Every configuration value is injected via
// `EdsClientDeps` — this module never reads an environment variable directly.
import type { TokenProvider } from "@hiberus-magento/mcp-core";
import {
  AdminApiAuthError,
  AdminApiStatusError,
  AdminRateLimitError,
  ContentSourceThrottledError,
  GatewayError,
  TransientNetworkError,
  UpstreamUnavailableError,
} from "./errors.js";
import { TokenBucketRateLimiter } from "./rate-limiter.js";

export interface EdsClientDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly tokenProvider: TokenProvider;
  readonly baseUrl: string;
  readonly org: string;
  readonly maxConcurrency?: number;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface SendOptions {
  readonly method: HttpMethod;
  readonly path: string;
  /** JSON-serializable value. When present, sent as the JSON body with a `content-type` header. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** What this request is for, e.g. `"the CDN config"` — named in the failure message so a caller that issues several requests says which one failed. */
  readonly label?: string;
  /**
   * Non-ok statuses this caller interprets itself, handed back as a
   * `Response` instead of thrown. Only the site-config existence GET and
   * the CDN-config probe use it: everywhere else an unhandled status must
   * become a named error, which is the whole point of this boundary.
   */
  readonly expectedStatuses?: readonly number[];
}

export interface HttpClient {
  send(options: SendOptions): Promise<Response>;
}

const GATEWAY_STATUSES = new Set([502, 504]);
const AUTH_STATUSES = new Set([401, 403]);

/** Enough of an error body to diagnose, never enough to paste a megabyte of HTML into a tool result. */
const MAX_DETAIL_CHARS = 500;

/**
 * Only ever called on the throw path, where nothing else will read the
 * body. The Admin API usually answers a failure with zero bytes and puts
 * the explanation in `x-error` instead, so the header is the fallback.
 */
async function readFailureDetail(response: Response): Promise<string | undefined> {
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }
  const detail = bodyText.trim() !== "" ? bodyText.trim() : (response.headers.get("x-error") ?? "").trim();
  if (detail === "") {
    return undefined;
  }
  return detail.length > MAX_DETAIL_CHARS ? `${detail.slice(0, MAX_DETAIL_CHARS)} ... (truncated)` : detail;
}

/**
 * The sole construction site for both throttle error classes (design.md,
 * Decision 3). Order is explicit and non-overlapping: `429` is always the
 * Admin API; a `503` is a content-source throttle only when its `x-error`
 * header contains the literal substring `"(429)"`; anything else is not a
 * throttle at all. Both are documented at https://www.aem.live/docs/limits.
 */
export function mapThrottle(status: number, headers: Headers): AdminRateLimitError | ContentSourceThrottledError | undefined {
  if (status === 429) {
    const retryAfterHeader = headers.get("retry-after");
    const retryAfterMs = retryAfterHeader !== null && retryAfterHeader !== "" ? Number(retryAfterHeader) * 1000 : undefined;
    return new AdminRateLimitError({ status, retryAfterMs });
  }
  if (status === 503) {
    const xError = headers.get("x-error") ?? "";
    if (xError.includes("(429)")) {
      return new ContentSourceThrottledError({ status, xError });
    }
  }
  return undefined;
}

export function createHttpClient(deps: EdsClientDeps): HttpClient {
  const rateLimiter = new TokenBucketRateLimiter({ ratePerSecond: 10, burst: 10 }, { now: deps.now, sleep: deps.sleep });

  return {
    async send(options: SendOptions): Promise<Response> {
      await rateLimiter.acquire();

      const credential = await deps.tokenProvider.getToken();
      const url = new URL(options.path, deps.baseUrl);
      const headers = new Headers(options.headers);
      headers.set("X-Auth-Token", credential.value);

      const init: RequestInit = { method: options.method, headers };
      if (options.body !== undefined) {
        init.body = JSON.stringify(options.body);
        headers.set("content-type", "application/json");
      }

      let response: Response;
      try {
        response = await deps.fetch(url, init);
      } catch (cause) {
        throw new TransientNetworkError(cause);
      }

      if (!response.ok) {
        const throttleError = mapThrottle(response.status, response.headers);
        if (throttleError) {
          throw throttleError;
        }
        if (GATEWAY_STATUSES.has(response.status)) {
          throw new GatewayError({ status: response.status });
        }
        if (response.status === 503) {
          throw new UpstreamUnavailableError({ status: response.status });
        }
        // Everything below this line used to fall through and return the
        // failing response, which the caller then `.json()`-ed. A status
        // is only handed back when the caller declared it interprets that
        // exact status itself — and never a throttle or gateway signal,
        // which no caller can act on locally.
        if (options.expectedStatuses?.includes(response.status) !== true) {
          const context = {
            status: response.status,
            method: options.method,
            path: options.path,
            label: options.label,
            detail: await readFailureDetail(response),
          };
          if (AUTH_STATUSES.has(response.status)) {
            throw new AdminApiAuthError({ ...context, credential: deps.tokenProvider.describeRemedy() });
          }
          throw new AdminApiStatusError(context);
        }
      }

      return response;
    },
  };
}
