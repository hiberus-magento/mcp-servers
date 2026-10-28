// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { fingerprint } from "./fingerprint.js";
import { createPlanStore } from "./plan-store.js";

describe("plan store", () => {
  const setup = () => {
    let now = 1_000;
    let n = 0;
    const store = createPlanStore<{ readonly kind: string }>({ now: () => now, ttlMs: 100, randomToken: () => `t${(n += 1)}` });
    return { store, advance: (ms: number) => (now += ms) };
  };

  it("returns a plan by token until it expires", () => {
    const { store, advance } = setup();
    const { token, expiresAt } = store.put({ kind: "page.publish" });
    expect(expiresAt).toBe(1_100);
    expect(store.get(token)).toEqual({ status: "ok", plan: { kind: "page.publish" } });
    advance(100);
    expect(store.get(token)).toEqual({ status: "expired" });
  });

  it("does not consume on get, and reports a consumed token as already applied", () => {
    const { store } = setup();
    const { token } = store.put({ kind: "page.publish" });
    store.get(token);
    expect(store.get(token).status).toBe("ok");
    store.consume(token);
    expect(store.get(token)).toEqual({ status: "already-applied" });
  });

  it("does not know a forged token", () => {
    const { store } = setup();
    store.put({ kind: "page.publish" });
    expect(store.get("forged")).toEqual({ status: "unknown-token" });
  });

  it("issues unguessable tokens by default", () => {
    const store = createPlanStore<number>({ now: () => 0 });
    const a = store.put(1).token;
    const b = store.put(2).token;
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe("fingerprint", () => {
  it("ignores key order and sees every value change", () => {
    expect(fingerprint({ a: 1, b: { c: [1, 2], d: "x" } })).toBe(fingerprint({ b: { d: "x", c: [1, 2] }, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
  });
});
