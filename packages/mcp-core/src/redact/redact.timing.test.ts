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

// The FASTEST of several runs, not a single sample. Every source of noise
// here — the scheduler preempting the run, another vitest worker taking the
// core, a GC pause — can only make a measurement slower, never faster, so
// the minimum is the sample least contaminated by interference. A single
// sample of the small input landing badly inflates the ratio on its own and
// fails a test whose subject did nothing wrong; this suite blocks CI, so a
// flaky assertion in it turns a green build into a coin toss.
const SAMPLES = 5;

function timeRedact(input: string): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let run = 0; run < SAMPLES; run += 1) {
    const start = performance.now();
    redact(input);
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
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
