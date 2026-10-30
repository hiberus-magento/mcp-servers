// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// One-time, expiring plan tokens (aem-sites-package design.md, D2). Same
// pattern as the `eds` server's plan store, implemented here so the two
// packages stay independent. In memory only: a plan does not survive a
// server restart, which is the safe direction to fail.
import { randomBytes } from "node:crypto";

export const DEFAULT_PLAN_TTL_MS = 10 * 60 * 1000;
/** Applied tokens remembered so a replay says "already applied" instead of "unknown". */
const MAX_REMEMBERED_APPLIED = 1_000;

export type PlanLookup<T> =
  | { readonly status: "ok"; readonly plan: T }
  | { readonly status: "unknown-token" | "expired" | "already-applied" };

interface Entry<T> {
  readonly plan: T;
  readonly expiresAt: number;
}

export interface PlanStore<T> {
  put(plan: T): { readonly token: string; readonly expiresAt: number };
  /** Looks a token up without consuming it, so a rejected echo does not burn the plan. */
  get(token: string): PlanLookup<T>;
  /** Consumes the token. Called only once every check before the first write has passed. */
  consume(token: string): void;
}

export function createPlanStore<T>(options: { readonly now: () => number; readonly ttlMs?: number; readonly randomToken?: () => string }): PlanStore<T> {
  const ttl = options.ttlMs ?? DEFAULT_PLAN_TTL_MS;
  const randomToken = options.randomToken ?? (() => randomBytes(24).toString("base64url"));
  const plans = new Map<string, Entry<T>>();
  const applied = new Set<string>();

  const sweep = (): void => {
    const now = options.now();
    for (const [token, entry] of plans) {
      if (entry.expiresAt <= now - ttl) {
        plans.delete(token);
      }
    }
  };

  return {
    put(plan) {
      sweep();
      const token = randomToken();
      const expiresAt = options.now() + ttl;
      plans.set(token, { plan, expiresAt });
      return { token, expiresAt };
    },
    get(token) {
      if (applied.has(token)) {
        return { status: "already-applied" };
      }
      const entry = plans.get(token);
      if (entry === undefined) {
        return { status: "unknown-token" };
      }
      if (options.now() >= entry.expiresAt) {
        return { status: "expired" };
      }
      return { status: "ok", plan: entry.plan };
    },
    consume(token) {
      plans.delete(token);
      applied.add(token);
      if (applied.size > MAX_REMEMBERED_APPLIED) {
        const oldest = applied.values().next().value;
        if (oldest !== undefined) {
          applied.delete(oldest);
        }
      }
    },
  };
}
