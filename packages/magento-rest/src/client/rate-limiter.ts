// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
export interface RateLimiterOptions { readonly ratePerSecond: number; readonly burst: number }
//
// Sliding-window request limiter over an injected clock. The same algorithm
// as `packages/aco/src/client/rate-limiter.ts` — deliberately a COPY, not an
// import: importing it would create a domain-to-domain runtime dependency,
// and the client-boundary lint rule forbids a deep cross-package `client/`
// import anyway.
//
// Deliberately NOT a continuous-refill token bucket: with `burst ===
// ratePerSecond` that allows `burst + ratePerSecond` requests inside a window
// straddling the initial burst. A sliding-window log — at most `burst`
// timestamps inside any rolling `windowMs` — makes "no more than
// `ratePerSecond` in any one-second window" true by construction.
export interface RateLimiterOptions {
  readonly ratePerSecond: number;
  readonly burst: number;
}

export interface RateLimiterDeps {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

// CHOSEN, NOT DOCUMENTED. Adobe Commerce publishes no fixed REST rate limit
// for a self-hosted or Cloud instance; throughput is bounded by the
// instance's own PHP workers. 5/s is a courtesy pace that keeps an agent
// loop from becoming a load test, not a limit anyone has published.
export const REST_PACE: RateLimiterOptions = { ratePerSecond: 5, burst: 5 };

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
   * Resolves once a slot is available within the rolling window. Callers are
   * serialized through one internal queue so concurrent waiters do not all
   * wake on the same tick.
   */
  acquire(): Promise<void> {
    const next = this.#queue.then(() => this.#acquireOne());
    // The queue itself must never reject, or every later `.then()` chained
    // onto it would skip `#acquireOne` for good.
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
      await this.#sleep(Math.max(1, oldest + this.#windowMs - now));
    }
  }

  #evictExpired(now: number): void {
    const cutoff = now - this.#windowMs;
    while (this.#timestamps.length > 0 && (this.#timestamps[0] as number) <= cutoff) {
      this.#timestamps.shift();
    }
  }
}
