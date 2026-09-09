// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Anti-ReDoS property test (design.md, Decision 6). Asserts a *scaling
// ratio* — time(N)/time(N/10) — rather than a fixed attack string or a
// fixed wall-clock bound, so the test is not machine-dependent and cannot
// be satisfied by simply special-casing one known-bad input. A linear-time
// implementation predicts a ~10x ratio for a 10x input growth; this
// asserts a generous upper bound of 15x to absorb CI noise while still
// failing hard on anything super-linear (a catastrophic-backtracking
// pattern would blow this bound by orders of magnitude, not by 50%).
import { describe, expect, it } from "vitest";
import { redact } from "./redact.js";

function adversarialInput(byteLength: number): string {
  // A long run of near-matching key=value-like characters: real "token="
  // prefixes that never resolve into a clean match boundary the way a
  // catastrophic-backtracking implementation would mishandle.
  const chunk = "token=abcdefghijklmnopqrstuvwxyz0123456789 ";
  const repeats = Math.ceil(byteLength / chunk.length);
  return chunk.repeat(repeats).slice(0, byteLength);
}

function timeRedact(input: string): number {
  const start = performance.now();
  redact(input);
  return performance.now() - start;
}

describe("redact (timing safety)", () => {
  it("scales linearly with input length, not catastrophically", () => {
    const small = adversarialInput(100_000); // 100 KB
    const large = adversarialInput(1_000_000); // 1 MB

    // Warm up the JIT so the first measurement isn't dominated by
    // compilation cost rather than the regex engine's actual complexity.
    redact(small);
    redact(large);

    const smallTimeMs = Math.max(timeRedact(small), 0.001);
    const largeTimeMs = Math.max(timeRedact(large), 0.001);

    const ratio = largeTimeMs / smallTimeMs;
    expect(ratio).toBeLessThan(15);
  });
});
