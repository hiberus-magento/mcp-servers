// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The one request boundary to an author (aem-sites-package design.md, D3,
// D6, D7). It pins the origin, attaches `Authorization: Bearer` only to that
// origin with `redirect: "manual"` (a redirect is how an expired token
// shows up, and following it would carry the bearer to the login host),
// fetches and caches the Granite CSRF token for every POST, and applies the
// retry policy recorded from the field CLI. It never reads environment
// variables or files: every dependency is injected.
import type { TokenProvider } from "@hiberus-magento/mcp-core";
import { AemAuthError, AemMalformedBodyError, AemStatusError, InvalidAuthorOriginError, TransientNetworkError, type RequestDescription } from "./errors.js";

const AUTHOR_ORIGIN = /^https:\/\/author-p\d+-e\d+\.adobeaemcloud\.com$/;
const CSRF_PATH = "/libs/granite/csrf/token.json";
const CSRF_TTL_MS = 60_000;
const REPLICATE_PATH = "/bin/replicate";

/** Field finding: a sheet page just created answers 409 to its first writes for a few seconds. */
const CONFLICT_BACKOFF_MS = [1_000, 2_000, 4_000] as const;
/** Field finding: activating to `publish` right after `preview` answers 400 once. */
const REPLICATE_400_RETRY_MS = 3_000;
const THROTTLE_RETRIES = 3;
const MAX_DETAIL_CHARS = 300;

export function assertAuthorOrigin(origin: string): string {
  if (!AUTHOR_ORIGIN.test(origin)) {
    throw new InvalidAuthorOriginError(origin);
  }
  return origin;
}

export interface AuthorHttpDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly tokenProvider: TokenProvider;
  /** `https://author-p<program>-e<environment>.adobeaemcloud.com`, validated on construction. */
  readonly origin: string;
}

export type FormFields = readonly (readonly [string, string])[];

export interface SendOptions {
  readonly method: "GET" | "POST";
  /** Path plus optional query string, always relative to the pinned origin. */
  readonly path: string;
  readonly form?: FormFields;
  readonly label?: string;
  /** Statuses the caller interprets itself (e.g. 404 for "absent"); returned instead of thrown. */
  readonly expectedStatuses?: readonly number[];
}

export interface AuthorResponse {
  readonly status: number;
  readonly text: string;
}

export interface AuthorHttp {
  readonly origin: string;
  send(options: SendOptions): Promise<AuthorResponse>;
  /** `send`, then the JSON body; an HTML body (the login page) becomes `AemAuthError`. */
  readJson<T = unknown>(options: SendOptions): Promise<{ readonly status: number; readonly body: T | undefined }>;
}

function excerpt(text: string): string | undefined {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed === "") {
    return undefined;
  }
  return trimmed.length > MAX_DETAIL_CHARS ? `${trimmed.slice(0, MAX_DETAIL_CHARS)}… (truncated)` : trimmed;
}

function looksLikeHtml(text: string): boolean {
  return /^\s*</.test(text);
}

function retryAfterMs(headers: Headers, attempt: number): number {
  const header = headers.get("retry-after");
  const seconds = header !== null ? Number(header) : Number.NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000 * 2 ** attempt;
}

export function createAuthorHttp(deps: AuthorHttpDeps): AuthorHttp {
  const origin = assertAuthorOrigin(deps.origin);
  let csrf: { readonly value: string; readonly fetchedAt: number } | undefined;

  const authFailure = (status: number, request: RequestDescription, reason: AemAuthError["reason"]): AemAuthError =>
    new AemAuthError({ reason, status, request, remedy: deps.tokenProvider.describeRemedy() });

  const rawFetch = async (method: "GET" | "POST", path: string, headers: Headers, body: string | undefined, request: RequestDescription) => {
    const credential = await deps.tokenProvider.getToken();
    headers.set("authorization", `Bearer ${credential.value}`);
    const init: RequestInit = { method, headers, redirect: "manual" };
    if (body !== undefined) {
      init.body = body;
    }
    try {
      return await deps.fetch(new URL(path, origin), init);
    } catch (cause) {
      throw new TransientNetworkError(request, cause);
    }
  };

  const csrfToken = async (force: boolean): Promise<string> => {
    if (!force && csrf !== undefined && deps.now() - csrf.fetchedAt < CSRF_TTL_MS) {
      return csrf.value;
    }
    const request = { method: "GET", path: CSRF_PATH, label: "the CSRF token" };
    const response = await rawFetch("GET", CSRF_PATH, new Headers({ accept: "application/json" }), undefined, request);
    const text = await response.text();
    if (response.status >= 300 && response.status < 400) {
      throw authFailure(response.status, request, "redirected-to-login");
    }
    if (response.status === 401) {
      throw authFailure(response.status, request, "token-expired-or-invalid");
    }
    let token: unknown;
    try {
      token = (JSON.parse(text) as { token?: unknown }).token;
    } catch {
      token = undefined;
    }
    if (typeof token !== "string" || token === "") {
      if (looksLikeHtml(text)) {
        throw authFailure(response.status, request, "redirected-to-login");
      }
      throw new AemMalformedBodyError({ status: response.status, request });
    }
    csrf = { value: token, fetchedAt: deps.now() };
    return token;
  };

  const send = async (options: SendOptions): Promise<AuthorResponse> => {
    const request: RequestDescription = { method: options.method, path: options.path, label: options.label };
    const body = options.form !== undefined ? new URLSearchParams(options.form.map(([k, v]) => [k, v])).toString() : undefined;
    const isReplicate = options.path === REPLICATE_PATH || options.path.startsWith(`${REPLICATE_PATH}?`);
    let conflictRetries = 0;
    let replicateRetried = false;
    let throttleRetries = 0;
    let csrfRefreshed = false;

    for (;;) {
      const headers = new Headers({ accept: "application/json" });
      if (options.method === "POST") {
        headers.set("content-type", "application/x-www-form-urlencoded; charset=utf-8");
        headers.set("csrf-token", await csrfToken(false));
      }
      const response = await rawFetch(options.method, options.path, headers, options.method === "POST" ? (body ?? "") : undefined, request);
      const status = response.status;
      const text = await response.text();

      if (options.expectedStatuses?.includes(status) === true) {
        return { status, text };
      }
      if (status >= 200 && status < 300) {
        return { status, text };
      }
      if (status >= 300 && status < 400) {
        throw authFailure(status, request, "redirected-to-login");
      }
      if (status === 401) {
        throw authFailure(status, request, "token-expired-or-invalid");
      }
      if (status === 403 && options.method === "POST" && !csrfRefreshed) {
        // A stale CSRF token answers 403 too: refresh it once, resend the same bytes.
        csrfRefreshed = true;
        await csrfToken(true);
        continue;
      }
      if (status === 403) {
        throw authFailure(status, request, "forbidden");
      }
      if (status === 409 && options.method === "POST" && conflictRetries < CONFLICT_BACKOFF_MS.length) {
        await deps.sleep(CONFLICT_BACKOFF_MS[conflictRetries] as number);
        conflictRetries += 1;
        continue;
      }
      if (status === 400 && isReplicate && !replicateRetried) {
        replicateRetried = true;
        await deps.sleep(REPLICATE_400_RETRY_MS);
        continue;
      }
      if ((status === 429 || status >= 500) && throttleRetries < THROTTLE_RETRIES) {
        await deps.sleep(retryAfterMs(response.headers, throttleRetries));
        throttleRetries += 1;
        continue;
      }
      throw new AemStatusError({ status, request, detail: looksLikeHtml(text) ? undefined : excerpt(text) });
    }
  };

  const readJson = async <T = unknown>(options: SendOptions): Promise<{ readonly status: number; readonly body: T | undefined }> => {
    const response = await send(options);
    if (response.status < 200 || response.status >= 300) {
      return { status: response.status, body: undefined };
    }
    const request: RequestDescription = { method: options.method, path: options.path, label: options.label };
    if (looksLikeHtml(response.text)) {
      throw authFailure(response.status, request, "redirected-to-login");
    }
    try {
      return { status: response.status, body: JSON.parse(response.text) as T };
    } catch {
      throw new AemMalformedBodyError({ status: response.status, request });
    }
  };

  return { origin, send, readJson };
}
