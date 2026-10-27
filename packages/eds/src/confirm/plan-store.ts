// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The plan store (eds-write-surface design.md, Decision 2): one-time,
// expiring, unguessable tokens for plans held in process memory only. It
// never interprets a plan — `T` is opaque here — so it can move to
// `mcp-core` unchanged if another package ever needs it.
import { randomBytes as nodeRandomBytes } from "node:crypto";

/** A plan lives ten minutes from issue (spec: "Tokens Are Single-Use, Expiring and Unforgeable"). */
export const PLAN_TTL_MS = 10 * 60 * 1000;
export const PLAN_STORE_CAPACITY = 100;
const TOKEN_BYTES = 32;

export type PlanRejection = "unknown-token" | "expired" | "used";

export type PlanLookup<T> =
  | { readonly status: "ok"; readonly plan: T; readonly reason?: undefined }
  | { readonly status: "rejected"; readonly reason: PlanRejection; readonly plan?: undefined };

export interface IssuedPlan {
  readonly token: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export interface PlanStoreOptions {
  readonly now: () => number;
  /** Injected for tests; defaults to `node:crypto`. */
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly capacity?: number;
}

export interface PlanStore<T> {
  issue(plan: T): IssuedPlan;
  /** Looks a plan up without consuming it — for checks that read and write nothing. */
  peek(token: string): PlanLookup<T>;
  /** Looks a plan up and consumes it: every later lookup reports `used`. */
  consume(token: string): PlanLookup<T>;
}

interface Entry<T> {
  readonly plan: T;
  readonly expiresAt: number;
  used: boolean;
}

export function createPlanStore<T>(options: PlanStoreOptions): PlanStore<T> {
  const randomBytes = options.randomBytes ?? ((size: number) => nodeRandomBytes(size));
  const capacity = options.capacity ?? PLAN_STORE_CAPACITY;
  // A `Map` iterates in insertion order, so its first key is the oldest plan.
  const entries = new Map<string, Entry<T>>();

  function evictFor(now: number): void {
    if (entries.size < capacity) return;
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(token);
    }
    while (entries.size >= capacity) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) return;
      entries.delete(oldest);
    }
  }

  function lookup(token: string, consume: boolean): PlanLookup<T> {
    const entry = entries.get(token);
    if (entry === undefined) return { status: "rejected", reason: "unknown-token" };
    if (entry.used) return { status: "rejected", reason: "used" };
    if (options.now() >= entry.expiresAt) return { status: "rejected", reason: "expired" };
    if (consume) entry.used = true;
    return { status: "ok", plan: entry.plan };
  }

  return {
    issue(plan) {
      const now = options.now();
      evictFor(now);
      const token = Buffer.from(randomBytes(TOKEN_BYTES)).toString("base64url");
      const expiresAt = now + PLAN_TTL_MS;
      entries.set(token, { plan, expiresAt, used: false });
      return { token, expiresAt };
    },
    peek: (token) => lookup(token, false),
    consume: (token) => lookup(token, true),
  };
}
