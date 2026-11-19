// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRAPHQL_PACE, TokenBucketRateLimiter } from "./rate-limiter.js";

describe("TokenBucketRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = () =>
    new TokenBucketRateLimiter(GRAPHQL_PACE, { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) });

  it("never sends more than GRAPHQL_PACE.ratePerSecond requests inside any rolling one-second window", async () => {
    const limiter = make();
    const stamps: number[] = [];
    const pending = Array.from({ length: 20 }, async () => {
      await limiter.acquire();
      stamps.push(Date.now());
    });
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.all(pending);
    expect(stamps).toHaveLength(20);
    for (const start of stamps) {
      expect(stamps.filter((t) => t >= start && t < start + 1000).length).toBeLessThanOrEqual(GRAPHQL_PACE.ratePerSecond);
    }
  });

  it("allows an initial burst with no wait", async () => {
    const limiter = make();
    const stamps: number[] = [];
    await Promise.all(
      Array.from({ length: GRAPHQL_PACE.burst }, async () => {
        await limiter.acquire();
        stamps.push(Date.now());
      }),
    );
    expect(new Set(stamps).size).toBe(1);
  });
});
