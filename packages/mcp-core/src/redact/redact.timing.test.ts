// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Anti-ReDoS property test (design.md, Decision 6).
//
// This used to compare time(1 MB) against time(100 KB) and require the
// ratio to stay under 15. It flaked, and widening the bound would have
// buried the reason. Measuring the two sizes directly showed throughput
// falling from ~62 MB/s at 100 KB to ~6 MB/s at 3 MB — and falling
// IDENTICALLY for input containing no secrets at all, which catastrophic
// backtracking cannot explain, because backtracking is driven by what the
// pattern nearly matches. The old test was measuring the machine's memory
// hierarchy and GC and calling it regex complexity. Being load-dependent is
// what made it flaky; being the wrong subject is what made it useless.
//
// So the comparison is now between two inputs of the SAME size: one built
// to make a backtracking matcher work hardest, one inert. Equal sizes mean
// cache behaviour, allocation and GC appear on both sides and cancel, and
// what remains is the only thing this test was ever about — whether the
// pattern's cost explodes on adversarial input.
//
// For scale: tool output is capped at 100 KB (`tools/define-tool.ts`),
// where redaction costs about 2 ms.
import { describe, expect, it } from "vitest";
import { redact } from "./redact.js";

const INPUT_BYTES = 200_000;

/**
 * A backtracking matcher's cost is driven by near-misses, so the worst case
 * is input that repeatedly looks like the start of a secret and then fails
 * to resolve: a real `token=` prefix whose value never terminates cleanly.
 */
function adversarialInput(byteLength: number): string {
  const chunk = "token=abcdefghijklmnopqrstuvwxyz0123456789 ";
  return chunk.repeat(Math.ceil(byteLength / chunk.length)).slice(0, byteLength);
}

/** The same shape and size with a key that is not in the secret set, so the
 * pattern can reject each chunk immediately. */
function inertInput(byteLength: number): string {
  const chunk = "lorem=abcdefghijklmnopqrstuvwxyz0123456789 ";
  return chunk.repeat(Math.ceil(byteLength / chunk.length)).slice(0, byteLength);
}

// The FASTEST of several runs, not a single sample. Every source of noise
// here — the scheduler preempting the run, another vitest worker taking the
// core, a GC pause — can only make a measurement slower, never faster, so
// the minimum is the sample least contaminated by interference. This suite
// blocks CI, so a flaky assertion in it turns a green build into a coin toss.
const SAMPLES = 7;

function timeFastest(run: () => void): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    const start = performance.now();
    run();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return Math.max(fastest, 0.001);
}

/** Cost on adversarial input relative to inert input OF THE SAME SIZE. */
function adversarialPenalty(match: (input: string) => void): number {
  const adversarial = adversarialInput(INPUT_BYTES);
  const inert = inertInput(INPUT_BYTES);

  // Warm up the JIT so the first measurement isn't dominated by compilation
  // cost rather than the matcher's actual complexity.
  match(adversarial);
  match(inert);

  return timeFastest(() => match(adversarial)) / timeFastest(() => match(inert));
}

/**
 * Measured at ~1.15 for the real pattern. A catastrophic matcher scores in
 * the thousands (the control below measures over 1000x on inputs a hundred
 * times smaller), so this bound has an enormous margin on the failing side
 * and roughly 4x of headroom on the passing side.
 */
const MAX_ADVERSARIAL_PENALTY = 5;

describe("redact (backtracking safety)", () => {
  it("costs no more on adversarial input than on inert input of the same size", () => {
    expect(adversarialPenalty(redact)).toBeLessThan(MAX_ADVERSARIAL_PENALTY);
  });

  // POSITIVE CONTROL. A bound proves nothing until something is shown to
  // exceed it: a probe that cannot fail is not a test. This runs a
  // deliberately catastrophic pattern — a nested quantifier, the shape
  // `redact.ts` avoids — through the same harness, on inputs small enough
  // to terminate. It must blow the bound the real pattern passes.
  it("positive control: the same harness fails a nested-quantifier pattern", () => {
    const catastrophic = /^(a+)+$/;
    // 20 is calibrated: the near-miss costs about 5 ms and scores ~2900x,
    // decisive without making the suite wait. The cost doubles per added
    // character, so a larger run would stall CI to prove the same point.
    const RUN_LENGTH = 20;
    // Fails to match only after exploring every partition of the run.
    const nearMiss = `${"a".repeat(RUN_LENGTH)}!`;
    // Same length, matches immediately.
    const clean = "a".repeat(RUN_LENGTH + 1);

    const penalty =
      timeFastest(() => {
        catastrophic.test(nearMiss);
      }) /
      timeFastest(() => {
        catastrophic.test(clean);
      });

    expect(penalty).toBeGreaterThan(MAX_ADVERSARIAL_PENALTY);
  });
});
