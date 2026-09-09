// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 3.8): proves the non-idempotent guard actually fails
// closed — a descriptor with `idempotent: false` must never be retried,
// regardless of how retryable its error would otherwise be.
import { describe, expect, it } from "vitest";
import { AdminRateLimitError, GatewayError, TransientNetworkError } from "./errors.js";
import { decideRetry, MAX_RETRY_ATTEMPTS } from "./retry.js";

describe("decideRetry", () => {
  it("never retries a descriptor with idempotent: false", () => {
    const outcome = { error: new AdminRateLimitError({ status: 429 }), idempotent: false as const };

    const decision = decideRetry(outcome, 1);

    expect(decision.retry).toBe(false);
    expect(decision.delayMs).toBe(0);
  });

  it("retries an idempotent AdminRateLimitError within the attempt budget", () => {
    const outcome = { error: new AdminRateLimitError({ status: 429 }), idempotent: true as const };

    const decision = decideRetry(outcome, 1);

    expect(decision.retry).toBe(true);
  });

  it("stops retrying once the attempt budget (3) is exhausted", () => {
    const outcome = { error: new TransientNetworkError(new Error("ECONNRESET")), idempotent: true as const };

    const decision = decideRetry(outcome, MAX_RETRY_ATTEMPTS);

    expect(decision.retry).toBe(false);
  });

  it("honors an explicit retry-after delay over computed backoff", () => {
    const outcome = { error: new GatewayError({ status: 502 }), idempotent: true as const, retryAfterMs: 5000 };

    const decision = decideRetry(outcome, 1);

    expect(decision.retry).toBe(true);
    expect(decision.delayMs).toBe(5000);
  });

  it("caps full-jitter backoff at 4000ms even at higher attempt numbers", () => {
    const outcome = { error: new GatewayError({ status: 504 }), idempotent: true as const };

    const decision = decideRetry(outcome, 2, () => 1);

    expect(decision.delayMs).toBeLessThanOrEqual(4000);
  });
});
