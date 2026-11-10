// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (eds-write-surface tasks.md 3.1–3.4; design.md Decision 2): the
// plan store issues one-time, expiring, unguessable tokens for opaque plans.
// It knows nothing about EDS — the plans here are plain objects on purpose.
import { describe, expect, it } from "vitest";
import { createPlanStore, PLAN_TTL_MS } from "./plan-store.js";

function makeClock(start = 1_000_000) {
  let current = start;
  return { now: () => current, advance: (ms: number) => { current += ms; } };
}

const PLAN = { site: "acme-demo-site-eu", kind: "config.patch" };

describe("createPlanStore — tokens (3.1)", () => {
  it("encodes 32 random bytes as base64url", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
    const store = createPlanStore({ now: () => 0, randomBytes: () => bytes });

    const { token } = store.issue(PLAN);

    expect(token).toBe(Buffer.from(bytes).toString("base64url"));
  });

  it("asks the random source for at least 32 bytes", () => {
    const requested: number[] = [];
    const store = createPlanStore({
      now: () => 0,
      randomBytes: (size) => { requested.push(size); return new Uint8Array(size); },
    });

    store.issue(PLAN);

    expect(requested).toEqual([32]);
  });

  it("defaults to a real random source: the same plan twice gets two different 43-char tokens", () => {
    const store = createPlanStore({ now: () => 0 });

    const first = store.issue(PLAN).token;
    const second = store.issue(PLAN).token;

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("returns the stored plan unchanged on lookup", () => {
    const store = createPlanStore({ now: () => 0 });
    const { token } = store.issue(PLAN);

    expect(store.peek(token)).toEqual({ status: "ok", plan: PLAN });
  });

  it("rejects a token it never issued as unknown-token", () => {
    const store = createPlanStore({ now: () => 0 });
    store.issue(PLAN);

    expect(store.peek("forged-token")).toEqual({ status: "rejected", reason: "unknown-token" });
    expect(store.consume("forged-token")).toEqual({ status: "rejected", reason: "unknown-token" });
  });
});

describe("createPlanStore — expiry (3.2)", () => {
  it("lives exactly ten minutes", () => {
    expect(PLAN_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("reports expiresAt as issue time plus ten minutes", () => {
    const clock = makeClock();
    const store = createPlanStore({ now: clock.now });

    expect(store.issue(PLAN).expiresAt).toBe(1_000_000 + PLAN_TTL_MS);
  });

  it("accepts the token until the last millisecond, then reports expired", () => {
    const clock = makeClock();
    const store = createPlanStore({ now: clock.now });
    const { token } = store.issue(PLAN);

    clock.advance(PLAN_TTL_MS - 1);
    expect(store.peek(token).status).toBe("ok");

    clock.advance(1);
    expect(store.peek(token)).toEqual({ status: "rejected", reason: "expired" });
    expect(store.consume(token)).toEqual({ status: "rejected", reason: "expired" });
  });
});

describe("createPlanStore — single use (3.3)", () => {
  it("consume returns the plan once; the second lookup reports used", () => {
    const store = createPlanStore({ now: () => 0 });
    const { token } = store.issue(PLAN);

    expect(store.consume(token)).toEqual({ status: "ok", plan: PLAN });
    expect(store.consume(token)).toEqual({ status: "rejected", reason: "used" });
    expect(store.peek(token)).toEqual({ status: "rejected", reason: "used" });
  });

  it("peek does not consume: the protected-site check may run any number of times first", () => {
    const store = createPlanStore({ now: () => 0 });
    const { token } = store.issue(PLAN);

    store.peek(token);
    store.peek(token);

    expect(store.consume(token)).toEqual({ status: "ok", plan: PLAN });
  });

  it("a used token past its expiry still never succeeds", () => {
    const clock = makeClock();
    const store = createPlanStore({ now: clock.now });
    const { token } = store.issue(PLAN);
    store.consume(token);

    clock.advance(PLAN_TTL_MS);

    expect(store.consume(token).status).toBe("rejected");
  });
});

describe("createPlanStore — bounded (3.4)", () => {
  it("holds at most 100 plans by default", () => {
    const store = createPlanStore({ now: () => 0 });
    const tokens = Array.from({ length: 100 }, (_, i) => store.issue({ i }).token);

    expect(tokens.every((token) => store.peek(token).status === "ok")).toBe(true);
  });

  it("the 101st plan evicts the oldest when none has expired", () => {
    const store = createPlanStore({ now: () => 0 });
    const tokens = Array.from({ length: 100 }, (_, i) => store.issue({ i }).token);

    const newest = store.issue({ i: 100 }).token;

    expect(store.peek(tokens[0]!)).toEqual({ status: "rejected", reason: "unknown-token" });
    expect(store.peek(tokens[1]!).status).toBe("ok");
    expect(store.peek(newest).status).toBe("ok");
  });

  it("the 101st plan evicts every expired plan, and then no live one", () => {
    // TTL is fixed, so an expired plan is always older than a live one;
    // "expired first" is observable only as evicting ALL of them at once
    // (oldest-only eviction would drop one and keep four dead entries).
    const clock = makeClock();
    const store = createPlanStore({ now: clock.now });
    const expired = Array.from({ length: 5 }, (_, i) => store.issue({ i }).token);
    clock.advance(PLAN_TTL_MS);
    const live = Array.from({ length: 95 }, (_, i) => store.issue({ i: i + 5 }).token);

    store.issue({ i: 100 });
    // Four more fit without evicting a live plan.
    const more = Array.from({ length: 4 }, (_, i) => store.issue({ i: i + 101 }).token);

    expect(expired.every((token) => store.peek(token).reason === "unknown-token")).toBe(true);
    expect([...live, ...more].every((token) => store.peek(token).status === "ok")).toBe(true);
  });

  it("issuing never fails when full", () => {
    const store = createPlanStore({ now: () => 0, capacity: 2 });

    for (let i = 0; i < 10; i += 1) store.issue({ i });
    const { token } = store.issue({ i: 10 });

    expect(store.peek(token).status).toBe("ok");
  });
});
