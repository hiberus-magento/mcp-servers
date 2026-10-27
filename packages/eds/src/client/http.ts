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
  AdminApiEmptyBodyError,
  AdminApiMalformedBodyError,
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
  /**
   * A plain-text body, sent byte for byte with `content-type: text/plain`.
   * Only `robots.txt` takes one. Never combined with `body`.
   */
  readonly text?: string;
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

/** Enough of a request to name it in a failure message. */
export type RequestContext = Pick<SendOptions, "method" | "path" | "label">;

/**
 * A successful response's body, for the operations that can legitimately
 * receive none. `content` is present exactly when `hasContent` is true —
 * never inferred from `content` being falsy, because `null`, `0`, `""` and
 * `{}` are all bodies the Admin API could return and all mean something
 * different from "there was no body".
 */
export interface OptionalJsonBody<T = unknown> {
  /** The successful status that carried (or did not carry) the body. */
  readonly status: number;
  readonly hasContent: boolean;
  /** `undefined` exactly when `hasContent` is false. */
  readonly content?: T;
}

export interface HttpClient {
  send(options: SendOptions): Promise<Response>;
  /**
   * `send`, then the JSON body the operation REQUIRES. A zero-length body
   * and an unparseable one each become a named error instead of a
   * `JSON.parse` failure surfacing to the operator.
   *
   * Not for a caller using `expectedStatuses`: that caller needs the
   * `Response` to branch on the status first, and reads the body itself
   * via `readJsonBody`.
   */
  readJson<T = unknown>(options: SendOptions): Promise<T>;
  /**
   * `send`, then a JSON body the operation may legitimately not receive —
   * a `204`, or any 2xx with zero bytes. A body that is present but
   * unparseable is still an error: this tolerates absence, not nonsense.
   */
  readOptionalJson<T = unknown>(options: SendOptions): Promise<OptionalJsonBody<T>>;
  /** `send`, then the body as text, unparsed — `""` for an empty body, which is a valid document here. */
  readText(options: SendOptions): Promise<string>;
}

const GATEWAY_STATUSES = new Set([502, 504]);
const AUTH_STATUSES = new Set([401, 403]);

/** Enough of an error body to diagnose, never enough to paste a megabyte of HTML into a tool result. */
const MAX_DETAIL_CHARS = 500;

function excerpt(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === "") {
    return undefined;
  }
  return trimmed.length > MAX_DETAIL_CHARS ? `${trimmed.slice(0, MAX_DETAIL_CHARS)} ... (truncated)` : trimmed;
}

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
  return excerpt(bodyText) ?? excerpt(response.headers.get("x-error") ?? "");
}

/**
 * The one place a response body is turned into text.
 *
 * `response.json()` is never called anywhere in this client, and that is
 * the point: it collapses "the API said nothing" and "the API said
 * something unreadable" into the same `Unexpected end of JSON input`, with
 * no status, method or path attached. Reading the text first keeps those
 * two apart and keeps the request that produced them in the message.
 *
 * A body stream that fails mid-read never produced a complete response, so
 * it is the same class of failure as the fetch itself failing.
 */
async function readBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (cause) {
    throw new TransientNetworkError(cause);
  }
}

function parseJsonBody<T>(text: string, status: number, context: RequestContext): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdminApiMalformedBodyError({ status, method: context.method, path: context.path, label: context.label, detail: excerpt(text) });
  }
}

/**
 * Reads a body the caller requires. Exported for the two callers that must
 * branch on the `Response` before reading it — `jobs.ts`, which reports
 * the status alongside the envelope, and the CDN-config probe, which asks
 * for a 404 via `expectedStatuses`.
 */
export async function readJsonBody<T = unknown>(response: Response, context: RequestContext): Promise<T> {
  const text = await readBodyText(response);
  if (text.trim() === "") {
    throw new AdminApiEmptyBodyError({ status: response.status, method: context.method, path: context.path, label: context.label });
  }
  return parseJsonBody<T>(text, response.status, context);
}

/** Reads a body the caller can do without — see `HttpClient.readOptionalJson`. */
export async function readOptionalJsonBody<T = unknown>(response: Response, context: RequestContext): Promise<OptionalJsonBody<T>> {
  const text = await readBodyText(response);
  if (text.trim() === "") {
    return { status: response.status, hasContent: false };
  }
  return { status: response.status, hasContent: true, content: parseJsonBody<T>(text, response.status, context) };
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

  const send = async (options: SendOptions): Promise<Response> => {
    await rateLimiter.acquire();

    const credential = await deps.tokenProvider.getToken();
    const url = new URL(options.path, deps.baseUrl);
    const headers = new Headers(options.headers);
    headers.set("X-Auth-Token", credential.value);

    const init: RequestInit = { method: options.method, headers };
    if (options.body !== undefined && options.text !== undefined) {
      throw new Error(`Internal error: ${options.method} ${options.path} was given both a JSON body and a text body.`);
    }
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
      headers.set("content-type", "application/json");
    } else if (options.text !== undefined) {
      init.body = options.text;
      headers.set("content-type", "text/plain");
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
  };

  return {
    send,
    readJson: async <T = unknown>(options: SendOptions): Promise<T> => readJsonBody<T>(await send(options), options),
    readOptionalJson: async <T = unknown>(options: SendOptions): Promise<OptionalJsonBody<T>> => readOptionalJsonBody<T>(await send(options), options),
    readText: async (options: SendOptions): Promise<string> => readBodyText(await send(options)),
  };
}
