// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The EDS client error hierarchy (design.md, Decision 3). `AdminRateLimitError`
// and `ContentSourceThrottledError` are two structurally distinct throttle
// classes that cannot be confused with each other: `mapThrottle` in
// `http.ts` is the sole construction site for both, `throttledBy` is a
// literal discriminant every consumer switches on, and the retry policy's
// input type (`retry.ts`) excludes `ContentSourceThrottledError` entirely —
// retrying the wrong one is a `tsc` error, not a judgement call.
//
// `AdminApiStatusError` and `AdminApiAuthError` are the FALLBACK for every
// non-ok status the classes above do not claim. They exist because `send()`
// used to classify 429/502/504/503 and then return the failing response
// anyway: a 400, 401, 403, 404 or 500 reached the caller as a `Response`
// that was immediately `.json()`-ed, and because the Admin API answers
// those with a zero-byte body, the operator was shown
// `Unexpected end of JSON input` instead of the status.
import type { Remedy } from "@hiberus-magento/mcp-core";

export type EdsErrorKind =
  | "admin-rate-limited"
  | "content-source-throttled"
  | "upstream-unavailable"
  | "transient-network"
  | "gateway"
  | "job-timeout"
  | "admin-api-status"
  | "admin-api-auth"
  | "admin-api-empty-body"
  | "admin-api-malformed-body";

export abstract class EdsError extends Error {
  abstract readonly kind: EdsErrorKind;
  abstract readonly remedy: string;
  readonly status?: number;
}

export interface AdminRateLimitErrorOptions {
  readonly status: number;
  readonly retryAfterMs?: number | undefined;
}

/** Adobe's documented Admin API limit: 10 requests/second per project. */
export class AdminRateLimitError extends EdsError {
  readonly kind = "admin-rate-limited" as const;
  readonly throttledBy = "admin-api" as const;
  readonly limit = "10 requests/second per project";
  override readonly status: number;
  readonly retryAfterMs: number | undefined;
  readonly remedy =
    "This client exceeded the Admin API rate. The request pacer will back off and retry; " +
    "if it persists, lower maxConcurrency or batch fewer paths per call.";

  constructor(options: AdminRateLimitErrorOptions) {
    super(`Admin API rate limit exceeded (HTTP ${options.status}). See https://www.aem.live/docs/limits.`);
    this.name = "AdminRateLimitError";
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export interface ContentSourceThrottledErrorOptions {
  readonly status: number;
  readonly xError: string;
}

/** Adobe's documented content-source limit: 100 concurrent / 600 requests-per-minute per site. */
export class ContentSourceThrottledError extends EdsError {
  readonly kind = "content-source-throttled" as const;
  readonly throttledBy = "content-source" as const;
  readonly limit = "100 concurrent and 600 requests/minute per site to the content source";
  override readonly status: number;
  readonly xError: string;
  readonly remedy =
    "The CONTENT SOURCE behind this site is throttling, not the Admin API. Client-side pacing will not fix it: " +
    "split the bulk operation into smaller batches and retry later.";

  constructor(options: ContentSourceThrottledErrorOptions) {
    super(`Content source throttled the request (HTTP ${options.status}, x-error: "${options.xError}").`);
    this.name = "ContentSourceThrottledError";
    this.status = options.status;
    this.xError = options.xError;
  }
}

export interface UpstreamUnavailableErrorOptions {
  readonly status: number;
}

/** A 5xx that is neither throttle signature — the upstream itself is unavailable. */
export class UpstreamUnavailableError extends EdsError {
  readonly kind = "upstream-unavailable" as const;
  override readonly status: number;
  readonly remedy = "The Admin API returned an unavailable/error status unrelated to rate limiting. Retry later.";

  constructor(options: UpstreamUnavailableErrorOptions) {
    super(`Admin API upstream unavailable (HTTP ${options.status}).`);
    this.name = "UpstreamUnavailableError";
    this.status = options.status;
  }
}

/** A fetch-level failure (DNS, TLS, connection reset) — no HTTP status at all. */
export class TransientNetworkError extends EdsError {
  readonly kind = "transient-network" as const;
  readonly remedy = "A network-level failure occurred before any HTTP response was received. Safe to retry.";

  constructor(cause: unknown) {
    super(`Transient network failure calling the Admin API: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "TransientNetworkError";
    this.cause = cause;
  }
}

export interface GatewayErrorOptions {
  readonly status: number;
}

/** 502/504 — a gateway-level failure, distinct from an application-level 503. */
export class GatewayError extends EdsError {
  readonly kind = "gateway" as const;
  override readonly status: number;
  readonly remedy = "The gateway in front of the Admin API failed. Safe to retry.";

  constructor(options: GatewayErrorOptions) {
    super(`Admin API gateway failure (HTTP ${options.status}).`);
    this.name = "GatewayError";
    this.status = options.status;
  }
}

export interface AdminApiFailureContext {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  /** What the request was for, e.g. `"the CDN config"`. Named in the message when present. */
  readonly label?: string | undefined;
  /** Bounded excerpt of the response body, or the `x-error` header when the body is empty. */
  readonly detail?: string | undefined;
}

/**
 * The Admin API answers most failures with a zero-byte body, so "what the
 * body says" is usually nothing at all — say so explicitly rather than
 * leaving a dangling quote the operator reads as a truncated message.
 */
function describeDetail(detail: string | undefined): string {
  return detail === undefined || detail === "" ? "The response body was empty." : `The response said: ${detail}`;
}

function describeRequest(context: AdminApiFailureContext): string {
  const label = context.label === undefined || context.label === "" ? "" : ` (${context.label})`;
  return `${context.method} ${context.path}${label}`;
}

function remedyForStatus(status: number): string {
  if (status === 404) {
    return "The Admin API has no document at that path. Check the org, site, ref and path spelling — a 404 here is an addressing problem, not a permissions one.";
  }
  if (status >= 400 && status < 500) {
    return "The Admin API rejected the request as invalid. Check the path and the request body against https://www.aem.live/docs/admin.html — retrying it unchanged will fail the same way.";
  }
  return "The Admin API failed server-side. Retry later; if it persists for one specific path, report the status and path to Adobe.";
}

/**
 * The fallback for any non-ok status no other class claims. Carries the
 * status, the method and path that produced it, and a bounded excerpt of
 * whatever the response said — so a failing call can never again surface
 * as a JSON parse error.
 */
export class AdminApiStatusError extends EdsError {
  readonly kind = "admin-api-status" as const;
  override readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly label: string | undefined;
  readonly detail: string | undefined;
  readonly remedy: string;

  constructor(context: AdminApiFailureContext) {
    super(`Admin API request failed: ${describeRequest(context)} returned HTTP ${context.status}. ${describeDetail(context.detail)}`);
    this.name = "AdminApiStatusError";
    this.status = context.status;
    this.method = context.method;
    this.path = context.path;
    this.label = context.label;
    this.detail = context.detail;
    this.remedy = remedyForStatus(context.status);
  }
}

export interface AdminApiAuthErrorOptions extends AdminApiFailureContext {
  readonly credential: Remedy;
}

/**
 * 401/403 — actionable in a way a bare status is not, so the message names
 * the credential and how to set it, in the same shape as `mcp-core`'s
 * `MissingCredentialError`. 401 means the key was not accepted at all; 403
 * means it was accepted and lacks the role for this operation (observed on
 * bulk status with a token minted without it).
 */
export class AdminApiAuthError extends EdsError {
  readonly kind = "admin-api-auth" as const;
  override readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly label: string | undefined;
  readonly detail: string | undefined;
  readonly credential: Remedy;
  readonly remedy: string;

  constructor(options: AdminApiAuthErrorOptions) {
    const cause = options.status === 401 ? "the credential was not accepted" : "the credential lacks permission for this operation";
    const remedy =
      `Run:      ${options.credential.cliCommand}     (reads the token from stdin)\n` +
      `Or set:   ${options.credential.envVar}=<value>\n` +
      `Checked:  ${options.credential.configPath}   (${options.credential.reason})`;
    super(
      `Admin API rejected the request with HTTP ${options.status} (${cause}) for domain "${options.credential.domain}": ` +
        `${describeRequest(options)}. ${describeDetail(options.detail)}\n${remedy}`,
    );
    this.name = "AdminApiAuthError";
    this.status = options.status;
    this.method = options.method;
    this.path = options.path;
    this.label = options.label;
    this.detail = options.detail;
    this.credential = options.credential;
    this.remedy = remedy;
  }
}

/**
 * A SUCCESSFUL status whose body this operation required and did not get.
 *
 * `send()` classifying every non-ok status fixed failures; it left
 * successes that carry nothing. The Admin API answers a snapshot `DELETE`
 * with `204` and zero bytes, and a zero-length body on any 2xx is the same
 * shape. Where the body IS the answer — a status document, a job envelope,
 * a page of audit entries — getting none is a real failure, and saying so
 * is what keeps "the API returned nothing" from being quietly reported as
 * "there is nothing", which an agent would act on.
 */
export class AdminApiEmptyBodyError extends EdsError {
  readonly kind = "admin-api-empty-body" as const;
  override readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly label: string | undefined;
  readonly remedy =
    "The Admin API accepted the request and returned no document, but this operation has nothing to report without one. " +
    "Confirm the org, site, ref and path address a document that exists; if they do, the status is worth reporting to Adobe.";

  constructor(context: AdminApiFailureContext) {
    super(`Admin API returned no content: ${describeRequest(context)} answered HTTP ${context.status} with a zero-length body, ` + `but this operation requires a document.`);
    this.name = "AdminApiEmptyBodyError";
    this.status = context.status;
    this.method = context.method;
    this.path = context.path;
    this.label = context.label;
  }
}

/**
 * A successful status whose body is present but is not JSON.
 *
 * Deliberately distinct from `AdminApiEmptyBodyError`: tolerating an
 * ABSENT body must never slide into tolerating an UNREADABLE one. Zero
 * bytes is the API saying nothing; `<html>...` is the API (or a proxy in
 * front of it) saying something this client cannot read, and that is still
 * a failure wherever it happens — including on the operations that accept
 * an empty body.
 */
export class AdminApiMalformedBodyError extends EdsError {
  readonly kind = "admin-api-malformed-body" as const;
  override readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly label: string | undefined;
  readonly detail: string | undefined;
  readonly remedy =
    "The Admin API answered with a body that is not JSON — usually an error page from a proxy in front of it rather than the API itself. " +
    "Retry; if the same path keeps answering this way, report the status and path to Adobe.";

  constructor(context: AdminApiFailureContext) {
    super(`Admin API returned an unreadable body: ${describeRequest(context)} answered HTTP ${context.status} with content that is not valid JSON. ${describeDetail(context.detail)}`);
    this.name = "AdminApiMalformedBodyError";
    this.status = context.status;
    this.method = context.method;
    this.path = context.path;
    this.label = context.label;
    this.detail = context.detail;
  }
}

export interface JobTimeoutErrorOptions {
  readonly self: string;
  readonly progress?: unknown | undefined;
}

/** Thrown by `waitForJob` when a job never reaches a terminal state within `timeoutMs`. */
export class JobTimeoutError extends EdsError {
  readonly kind = "job-timeout" as const;
  readonly self: string;
  readonly progress: unknown;
  readonly remedy = "The job did not complete within the configured timeout. Resume polling via eds_get_job_status.";

  constructor(options: JobTimeoutErrorOptions) {
    super(`Job polling timed out waiting on ${options.self}.`);
    this.name = "JobTimeoutError";
    this.self = options.self;
    this.progress = options.progress;
  }
}
