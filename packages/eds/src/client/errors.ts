// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The EDS client error hierarchy (design.md, Decision 3). `AdminRateLimitError`
// and `ContentSourceThrottledError` are two structurally distinct throttle
// classes that cannot be confused with each other: `mapThrottle` in
// `http.ts` is the sole construction site for both, `throttledBy` is a
// literal discriminant every consumer switches on, and the retry policy's
// input type (`retry.ts`) excludes `ContentSourceThrottledError` entirely —
// retrying the wrong one is a `tsc` error, not a judgement call.
export type EdsErrorKind =
  | "admin-rate-limited"
  | "content-source-throttled"
  | "upstream-unavailable"
  | "transient-network"
  | "gateway"
  | "job-timeout";

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
