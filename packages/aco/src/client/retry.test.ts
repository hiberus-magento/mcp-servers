// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 1.16): mirrors `packages/eds/src/client/retry.test.ts`
// (read-only) — proves the non-idempotent guard fails closed: a descriptor
// with `idempotent: false` must never be retried, regardless of how
// retryable its error would otherwise be. ACO never populates
// `retryAfterMs` on any of its own errors (there is no `Retry-After` on
// this surface), but `decideRetry` still honors it when supplied, matching
// EDS's pure policy shape.
import { describe, expect, it } from "vitest";
import { AcoThrottledError, AcoTransportError } from "./errors.js";
import { decideRetry, MAX_RETRY_ATTEMPTS } from "./retry.js";

describe("decideRetry", () => {
  it("never retries a descriptor with idempotent: false", () => {
    const outcome = { error: new AcoThrottledError({ operationName: "UpdatePolicy" }), idempotent: false as const };

    const decision = decideRetry(outcome, 1);

    expect(decision.retry).toBe(false);
    expect(decision.delayMs).toBe(0);
  });

  it("retries an idempotent AcoThrottledError within the attempt budget", () => {
    const outcome = { error: new AcoThrottledError({ operationName: "ListPriceBooks" }), idempotent: true as const };

    const decision = decideRetry(outcome, 1);

    expect(decision.retry).toBe(true);
  });

  it("stops retrying once the attempt budget (3) is exhausted", () => {
    const outcome = { error: new AcoTransportError({ reason: "fetch-rejected" }), idempotent: true as const };

    const decision = decideRetry(outcome, MAX_RETRY_ATTEMPTS);

    expect(decision.retry).toBe(false);
  });

  it("honors an explicit retryAfterMs when supplied, over computed backoff", () => {
    const outcome = { error: new AcoTransportError({ reason: "no-graphql-envelope", status: 503 }), idempotent: true as const, retryAfterMs: 2000 };

    const decision = decideRetry(outcome, 1);

    expect(decision.retry).toBe(true);
    expect(decision.delayMs).toBe(2000);
  });

  it("caps full-jitter backoff at 4000ms even at higher attempt numbers", () => {
    const outcome = { error: new AcoTransportError({ reason: "unparseable-body" }), idempotent: true as const };

    const decision = decideRetry(outcome, 2, () => 1);

    expect(decision.delayMs).toBeLessThanOrEqual(4000);
  });
});
