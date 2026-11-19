// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A pure retry policy: `(outcome, attempt) -> {retry, delayMs}`. Full-jitter
// exponential backoff, base 250 ms, cap 4 s. `idempotent` is REQUIRED, so
// omitting it is a `tsc` error rather than a silent "retry everything" that
// would replay a write: a Magento POST/PUT/DELETE is never retried, because
// replaying `create_invoice` or `create_creditmemo` after an ambiguous
// failure could capture or refund twice.
export interface RetryOutcome {
  readonly retryable: boolean;
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
const RETRY_AFTER_CAP_MS = 10_000;

/** `attempt` is the number of attempts already made (1 after the first failure). */
export function decideRetry(outcome: RetryOutcome, attempt: number, random: () => number = Math.random): RetryDecision {
  if (!outcome.idempotent || !outcome.retryable || attempt >= MAX_RETRY_ATTEMPTS) {
    return { retry: false, delayMs: 0 };
  }
  if (outcome.retryAfterMs !== undefined) {
    return { retry: true, delayMs: Math.min(outcome.retryAfterMs, RETRY_AFTER_CAP_MS) };
  }
  const cappedExponential = Math.min(CAP_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  return { retry: true, delayMs: Math.floor(random() * cappedExponential) };
}
