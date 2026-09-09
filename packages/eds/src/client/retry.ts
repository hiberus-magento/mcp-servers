// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A pure retry policy (design.md, Decision 5): `(outcome, attempt) ->
// {retry, delayMs}`. Full-jitter exponential backoff, base 250 ms, cap 4 s,
// honoring `retry-after` when present. Retryable errors are exactly
// `AdminRateLimitError | TransientNetworkError | GatewayError` —
// `ContentSourceThrottledError` is deliberately NOT part of this union
// (proven by `retry.test-d.ts`): retrying a content-source throttle is the
// wrong remedy, and the type system says so. Gated on a REQUIRED
// `idempotent` field so omitting it is a `tsc` error, never a silent
// "retry everything" default that would replay a write.
import type { AdminRateLimitError, GatewayError, TransientNetworkError } from "./errors.js";

export type RetryableError = AdminRateLimitError | TransientNetworkError | GatewayError;

export interface RetryOutcome {
  readonly error: RetryableError;
  readonly idempotent: boolean;
  readonly retryAfterMs?: number;
}

export interface RetryDecision {
  readonly retry: boolean;
  readonly delayMs: number;
}

export const MAX_RETRY_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;
const CAP_DELAY_MS = 4000;

/**
 * `attempt` is the number of attempts already made (1 after the first
 * failure). `random` is injectable so full-jitter behavior stays testable.
 */
export function decideRetry(outcome: RetryOutcome, attempt: number, random: () => number = Math.random): RetryDecision {
  if (!outcome.idempotent) {
    return { retry: false, delayMs: 0 };
  }
  if (attempt >= MAX_RETRY_ATTEMPTS) {
    return { retry: false, delayMs: 0 };
  }
  if (outcome.retryAfterMs !== undefined) {
    return { retry: true, delayMs: outcome.retryAfterMs };
  }
  const cappedExponential = Math.min(CAP_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  const delayMs = Math.floor(random() * cappedExponential);
  return { retry: true, delayMs };
}
