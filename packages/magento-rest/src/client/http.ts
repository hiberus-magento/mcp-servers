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
}

export interface RestTransportDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Injectable so full-jitter backoff stays testable. */
  readonly random?: () => number;
  readonly baseUrl: string;
  readonly tokenProvider: TokenProvider;
}

export interface RestTransport {
  request(request: RestRequest): Promise<unknown>;
}

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

function assertPath(path: string): void {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error("A REST path must start with / and carry no query or fragment; build it with restPath().");
  }
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
  const random = deps.random ?? Math.random;
  const rateLimiter = new TokenBucketRateLimiter(REST_PACE, { now: deps.now, sleep: deps.sleep });

  async function attemptOnce(request: RestRequest): Promise<{ readonly value: unknown } | { readonly failure: MagentoRestError; readonly retryAfterMs?: number }> {
    await rateLimiter.acquire();
    const credential = await deps.tokenProvider.getToken();
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${credential.value}` };
    const hasBody = request.body !== undefined;
    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await deps.fetch(`${baseUrl}${request.path}${request.query !== undefined && request.query !== "" ? `?${request.query}` : ""}`, {
        method: request.method,
        headers,
        // A redirect would re-send the request somewhere the operator never
        // configured; surface it as a failure instead of following it.
        redirect: "manual",
        ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
      });
    } catch (cause) {
      return {
        failure: new MagentoRestError({
          kind: "transport",
          message: "Magento REST request failed before a response was received.",
          retryable: true,
          cause,
        }),
      };
    }

    const text = await response.text();
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

  return {
    async request(request: RestRequest): Promise<unknown> {
      assertPath(request.path);
      const idempotent = request.method === "GET";
      for (let attempt = 1; ; attempt += 1) {
        const outcome = await attemptOnce(request);
        if ("value" in outcome) {
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
