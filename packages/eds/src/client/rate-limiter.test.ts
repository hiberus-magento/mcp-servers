// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 3.10): proves the Admin API pacing requirement
// (eds-client spec, "Admin API Request Pacing") under `vi.useFakeTimers()`
// — more than 10 queued requests must never exceed 10 sent within any
// rolling one-second window.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenBucketRateLimiter } from "./rate-limiter.js";

describe("TokenBucketRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never sends more than 10 requests within any rolling one-second window", async () => {
    const limiter = new TokenBucketRateLimiter(
      { ratePerSecond: 10, burst: 10 },
      { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    );

    const sendTimestamps: number[] = [];
    const total = 25;
    const pending = Array.from({ length: total }, async () => {
      await limiter.acquire();
      sendTimestamps.push(Date.now());
    });

    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(pending);

    expect(sendTimestamps).toHaveLength(total);
    for (const windowStart of sendTimestamps) {
      const countInWindow = sendTimestamps.filter((t) => t >= windowStart && t < windowStart + 1000).length;
      expect(countInWindow).toBeLessThanOrEqual(10);
    }
  });

  it("allows an initial burst of up to `burst` requests with no wait", async () => {
    const limiter = new TokenBucketRateLimiter(
      { ratePerSecond: 10, burst: 10 },
      { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    );

    const sendTimestamps: number[] = [];
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        await limiter.acquire();
        sendTimestamps.push(Date.now());
      }),
    );

    expect(sendTimestamps).toHaveLength(10);
    expect(new Set(sendTimestamps).size).toBe(1);
  });
});
