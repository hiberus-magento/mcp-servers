// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 1.14): mirrors `packages/eds/src/client/rate-limiter.test.ts`
// (read-only) — N queued requests never exceed the configured rate within
// any rolling one-second window, under `vi.useFakeTimers()`. This proves
// the pacing requirement (aco-client spec, "Conservative Token-Bucket
// Pacing") for ACO's own `ADMIN_PACE`/`MERCH_PACE` constants.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_PACE, MERCH_PACE, TokenBucketRateLimiter } from "./rate-limiter.js";

describe("TokenBucketRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never sends more than ADMIN_PACE.ratePerSecond requests within any rolling one-second window", async () => {
    const limiter = new TokenBucketRateLimiter(ADMIN_PACE, {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });

    const sendTimestamps: number[] = [];
    const total = 20;
    const pending = Array.from({ length: total }, async () => {
      await limiter.acquire();
      sendTimestamps.push(Date.now());
    });

    await vi.advanceTimersByTimeAsync(6000);
    await Promise.all(pending);

    expect(sendTimestamps).toHaveLength(total);
    for (const windowStart of sendTimestamps) {
      const countInWindow = sendTimestamps.filter((t) => t >= windowStart && t < windowStart + 1000).length;
      expect(countInWindow).toBeLessThanOrEqual(ADMIN_PACE.ratePerSecond);
    }
  });

  it("allows an initial burst of up to `burst` requests with no wait", async () => {
    const limiter = new TokenBucketRateLimiter(MERCH_PACE, {
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });

    const sendTimestamps: number[] = [];
    await Promise.all(
      Array.from({ length: MERCH_PACE.burst }, async () => {
        await limiter.acquire();
        sendTimestamps.push(Date.now());
      }),
    );

    expect(sendTimestamps).toHaveLength(MERCH_PACE.burst);
    expect(new Set(sendTimestamps).size).toBe(1);
  });

  it("ADMIN_PACE is more conservative than MERCH_PACE — the admin surface has evidence of only a courtesy delay", () => {
    expect(ADMIN_PACE.ratePerSecond).toBeLessThan(MERCH_PACE.ratePerSecond);
  });
});
