// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Sliding-window request limiter over an injected clock (design.md,
// Decision 5): `ratePerSecond: 10, burst: 10` satisfies both the documented
// Admin API limit (10 requests/second per project) and — because 600
// requests/minute is exactly 10/second — the content-source limit too.
// Rejected: a `MIN_GAP` sleep loop (untestable, drifts under real timers).
//
// Deliberately NOT a continuous-refill token bucket: with `burst ===
// ratePerSecond`, a continuous bucket allows up to `burst + ratePerSecond`
// requests inside a window that straddles the initial burst (the bucket
// starts full AND keeps refilling during the same window) — provably
// violating "no more than `ratePerSecond` requests in any one-second
// window" (eds-client spec, "Admin API Request Pacing"). A sliding-window
// log — at most `burst` recorded timestamps inside any rolling `windowMs`
// — makes that invariant true by construction, not by tuning.
export interface RateLimiterOptions {
  readonly ratePerSecond: number;
  readonly burst: number;
}

export interface RateLimiterDeps {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export class TokenBucketRateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #timestamps: number[] = [];
  #queue: Promise<void>;

  constructor(options: RateLimiterOptions, deps: RateLimiterDeps) {
    this.#limit = options.burst;
    this.#windowMs = (options.burst / options.ratePerSecond) * 1000;
    this.#now = deps.now;
    this.#sleep = deps.sleep;
    this.#queue = Promise.resolve();
  }

  /**
   * Resolves once a slot is available within the rolling window. Callers
   * are serialized through a single internal queue so concurrent callers
   * waiting on the same limiter do not all wake up and stampede on the same
   * tick.
   */
  acquire(): Promise<void> {
    const next = this.#queue.then(() => this.#acquireOne());
    // The queue itself must never reject, or every subsequent `.then()`
    // chained onto it would short-circuit past `#acquireOne` for good.
    this.#queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async #acquireOne(): Promise<void> {
    for (;;) {
      const now = this.#now();
      this.#evictExpired(now);
      if (this.#timestamps.length < this.#limit) {
        this.#timestamps.push(now);
        return;
      }
      const oldest = this.#timestamps[0] as number;
      const waitMs = Math.max(1, oldest + this.#windowMs - now);
      await this.#sleep(waitMs);
    }
  }

  #evictExpired(now: number): void {
    const cutoff = now - this.#windowMs;
    while (this.#timestamps.length > 0 && (this.#timestamps[0] as number) <= cutoff) {
      this.#timestamps.shift();
    }
  }
}
