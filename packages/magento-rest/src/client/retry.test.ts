// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { MAX_RETRY_ATTEMPTS, decideRetry } from "./retry.js";

describe("decideRetry", () => {
  it("never retries a non-idempotent request, however retryable the failure", () => {
    expect(decideRetry({ retryable: true, idempotent: false }, 1)).toEqual({ retry: false, delayMs: 0 });
  });

  it("never retries a non-retryable failure", () => {
    expect(decideRetry({ retryable: false, idempotent: true }, 1).retry).toBe(false);
  });

  it("retries an idempotent retryable failure inside the budget", () => {
    expect(decideRetry({ retryable: true, idempotent: true }, 1).retry).toBe(true);
  });

  it("stops once the attempt budget is exhausted", () => {
    expect(decideRetry({ retryable: true, idempotent: true }, MAX_RETRY_ATTEMPTS).retry).toBe(false);
  });

  it("honors retryAfterMs over computed backoff, capped", () => {
    expect(decideRetry({ retryable: true, idempotent: true, retryAfterMs: 2000 }, 1).delayMs).toBe(2000);
    expect(decideRetry({ retryable: true, idempotent: true, retryAfterMs: 999_999 }, 1).delayMs).toBe(10_000);
  });

  it("uses full-jitter exponential backoff capped at 4s", () => {
    expect(decideRetry({ retryable: true, idempotent: true }, 1, () => 0.5).delayMs).toBe(125);
    expect(decideRetry({ retryable: true, idempotent: true }, 2, () => 0.5).delayMs).toBe(250);
    expect(decideRetry({ retryable: true, idempotent: true }, 2, () => 0.999999).delayMs).toBeLessThan(500);
  });
});
