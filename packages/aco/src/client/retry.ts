// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A pure retry policy (design.md, Decision 4): `(outcome, attempt) ->
// {retry, delayMs}`. Full-jitter exponential backoff, base 250ms, cap 4s.
// Mirrors `packages/eds/src/client/retry.ts` (read-only). Retryable errors
// are exactly `RetryableAcoError = AcoThrottledError | AcoTransportError`
// (`errors.ts`) — `AdminScopeError | CatalogViewAccessError |
// AcoOperationError | AcoSchemaMismatchError` are NOT members, proven by
// `errors.test-d.ts`. Gated on a REQUIRED `idempotent` field so omitting it
// is a `tsc` error, never a silent "retry everything" default that would
// replay a write — the six admin mutations (Phase 2) all declare
// `idempotent: false`.
//
// ACO never populates `retryAfterMs` on its own errors — there is no
// `Retry-After` on this surface, so backoff is always full-jitter
// exponential in practice. `decideRetry` still honors an explicit
// `retryAfterMs` when supplied, keeping the same pure-policy shape as EDS.
import type { RetryableAcoError } from "./errors.js";

export interface RetryOutcome {
  readonly error: RetryableAcoError;
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
