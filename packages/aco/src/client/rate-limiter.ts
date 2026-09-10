// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Sliding-window request limiter over an injected clock (design.md,
// Decision 4). Same algorithm and tests as `packages/eds/src/client/rate-limiter.ts`
// (read-only) — deliberately a COPY, not an import: importing it would
// create a domain→domain runtime dependency and drag `eds`'s bundle into
// `aco`'s, and the `no-restricted-imports` client-boundary rule forbids a
// deep cross-package `client/` import anyway. `ADMIN_PACE`/`MERCH_PACE` are
// this package's own numbers, chosen — not documented; see below.
//
// Deliberately NOT a continuous-refill token bucket: with `burst ===
// ratePerSecond`, a continuous bucket allows up to `burst + ratePerSecond`
// requests inside a window that straddles the initial burst — provably
// violating "no more than `ratePerSecond` requests in any one-second
// window". A sliding-window log — at most `burst` recorded timestamps
// inside any rolling `windowMs` — makes that invariant true by
// construction, not by tuning.
export interface RateLimiterOptions {
  readonly ratePerSecond: number;
  readonly burst: number;
}

export interface RateLimiterDeps {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

// CHOSEN, NOT DOCUMENTED. Adobe publishes no rate limit for either ACO
// surface. The only pacing ever observed to work against a real tenant is
// the reverse-engineered CLI's 0.3-0.4s courtesy delay between writes
// (~2.5-3.3 requests/second). 4/s is the honest upper bound of that
// evidence, not a limit anyone has published.
export const ADMIN_PACE: RateLimiterOptions = { ratePerSecond: 4, burst: 4 };

// Merchandising is a read surface with no observed pacing at all; 10/s
// matches the EDS default so the two packages do not drift for no reason.
// Also undocumented.
export const MERCH_PACE: RateLimiterOptions = { ratePerSecond: 10, burst: 10 };

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
