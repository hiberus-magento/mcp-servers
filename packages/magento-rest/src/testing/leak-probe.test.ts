// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { LEAK_PROBE_VALUE, injectLeakProbe } from "./leak-probe.js";

describe("injectLeakProbe", () => {
  it("adds the probe field to every object at every depth, including inside arrays", () => {
    // Three objects (the root, `b`, and the one inside the array); the array itself is not an object to probe.
    const out = JSON.stringify(injectLeakProbe({ a: 1, b: { c: [{ d: 2 }] } }));
    expect(out.split(LEAK_PROBE_VALUE)).toHaveLength(4);
  });

  it("leaves primitives and the original value untouched", () => {
    const original = { a: 1 };
    injectLeakProbe(original);
    expect(original).toEqual({ a: 1 });
    expect(injectLeakProbe(true)).toBe(true);
    expect(injectLeakProbe("x")).toBe("x");
  });
});
