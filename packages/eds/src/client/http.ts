// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The single request-building boundary (design.md, Decision 2 & 4): attaches
// the `X-Auth-Token` header (never `Authorization: token <key>` — see
// design.md, Decision 4, for why that shape defeats mcp-core's own
// redaction), awaits the rate limiter, and is `mapThrottle`'s only caller
// (design.md, Decision 3). Every configuration value is injected via
// `EdsClientDeps` — this module never reads `process.env`.
import type { TokenProvider } from "@hiberus-magento/mcp-core";
import { AdminRateLimitError, ContentSourceThrottledError, GatewayError, TransientNetworkError, UpstreamUnavailableError } from "./errors.js";
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
}

export interface HttpClient {
  send(options: SendOptions): Promise<Response>;
}

const GATEWAY_STATUSES = new Set([502, 504]);

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
      }

      return response;
    },
  };
}
