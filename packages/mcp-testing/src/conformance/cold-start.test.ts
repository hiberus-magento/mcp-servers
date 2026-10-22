// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 12.5): `describeConformance` must fail when a
// server's median cold-start (5 samples) exceeds `COLD_START_BUDGET_MS`.
// `checkColdStart` is the pure check, extracted the same way as
// `checkStdoutPurity`/`checkToolMetadataComplete`, so the failure path is
// directly drivable. The real-process proof spawns
// `slow-cold-start-subject.fixture.mjs`, which is deliberately slower than
// any realistic budget, through the actual `measureMedianColdStart` used by
// `describeConformance`'s own cold-start `it()`.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COLD_START_BUDGET_MS,
  MAX_STARTUP_CPU_RATIO,
  MAX_STARTUP_CPU_RATIO_OVERRIDE,
  checkColdStart,
  checkStartupCpuRatio,
  measureMedianColdStart,
  measureStartupCpu,
  measureStartupCpuRatio,
  startupCpuReferencePath,
  resolveStartupCpuRatio,
  startupCpuTestTitle,
} from "./cold-start.js";

describe("checkColdStart", () => {
  it("passes when the median is at or under the budget", () => {
    expect(checkColdStart(100, 250)).toBeUndefined();
    expect(checkColdStart(250, 250)).toBeUndefined();
  });

  it("fails and reports both figures when the median exceeds the budget", () => {
    const violation = checkColdStart(300, 250);
    expect(violation).toEqual({ medianMs: 300, budgetMs: 250 });
  });
});

const SLOW_SUBJECT_PATH = fileURLToPath(new URL("./slow-cold-start-subject.fixture.mjs", import.meta.url));
const CPU_HEAVY_SUBJECT_PATH = fileURLToPath(new URL("./cpu-heavy-startup-subject.fixture.mjs", import.meta.url));

// CHANGED DELIBERATELY: this block now guards the wall-clock DIAGNOSTIC, not
// the CI gate — `describeConformance` asserts startup CPU instead
// (`cold-start.ts`'s header says why). The assertions themselves are
// unweakened and the subject is unchanged.
describe("measureMedianColdStart + checkColdStart — proves the wall-clock diagnostic fires against a genuinely slow subject", () => {
  it("reports a violation for a subject slower than COLD_START_BUDGET_MS", async () => {
    const { medianMs } = await measureMedianColdStart(SLOW_SUBJECT_PATH, 3);

    expect(medianMs).toBeGreaterThan(COLD_START_BUDGET_MS);
    const violation = checkColdStart(medianMs, COLD_START_BUDGET_MS);
    expect(violation).toBeDefined();
    expect(violation?.budgetMs).toBe(COLD_START_BUDGET_MS);
  }, 15_000);
});

describe("checkStartupCpuRatio", () => {
  it("passes at or under the maximum", () => {
    expect(checkStartupCpuRatio(1.1, 2)).toBeUndefined();
    expect(checkStartupCpuRatio(2, 2)).toBeUndefined();
  });

  it("fails and reports both figures over the maximum", () => {
    expect(checkStartupCpuRatio(2.5, 2)).toEqual({ ratio: 2.5, maxRatio: 2 });
  });

  // A ratio is a division, and a division has degenerate results an absolute
  // budget never had. `NaN > maxRatio` is FALSE, so a comparison written the
  // obvious way reports a pass for a measurement that never happened — and
  // the budget this replaced failed CLOSED there, because `Infinity > 75` is
  // a violation. Swapping a gate's failure direction while making it
  // machine-independent would have traded one silent hole for another.
  it("treats a ratio that is not a number as a violation, not a pass", () => {
    expect(checkStartupCpuRatio(Number.NaN, 2)).toEqual({ ratio: Number.NaN, maxRatio: 2 });
  });

  it("treats an infinite ratio as a violation", () => {
    expect(checkStartupCpuRatio(Number.POSITIVE_INFINITY, 2)).toEqual({
      ratio: Number.POSITIVE_INFINITY,
      maxRatio: 2,
    });
  });
});

// `Math.min()` of nothing is `Infinity`, so a sample count below 1 divides
// Infinity by Infinity and hands `checkStartupCpuRatio` a NaN. The check
// above now catches that, but a measurement that cannot be taken is a
// caller's mistake, and reporting it as a failed gate would send whoever
// reads the CI log hunting for a performance regression that never existed.
describe("measureStartupCpuRatio — degenerate sample counts", () => {
  it("refuses a sample count below one instead of returning an unusable ratio", async () => {
    await expect(measureStartupCpuRatio(startupCpuReferencePath(), 0)).rejects.toThrow(/sample count/i);
  });
});

// The ratio is only machine-independent if its denominator is a real
// workload. A baseline that measured nothing but the ESM loader's fixed
// cost would turn the gate back into an absolute budget wearing a ratio's
// clothes: the numerator would carry all the machine-dependence and the
// denominator none of it. This pins that the reference module actually
// costs something, in the only terms that survive a change of machine —
// against an empty module measured in the same run.
describe("the startup-CPU reference module", () => {
  it("costs far more than the fixed per-import overhead it has to dominate", async () => {
    const emptyPath = join(mkdtempSync(join(tmpdir(), "mcp-startup-cpu-empty-")), "empty.mjs");
    writeFileSync(emptyPath, "export {};\n");

    const empty = await measureStartupCpu(emptyPath, 3);
    const reference = await measureStartupCpu(startupCpuReferencePath(), 3);

    // Measured at ~56x on the machine `cold-start.ts` records; 10x is the
    // line below which the denominator would stop being a workload.
    expect(reference.minCpuMs / empty.minCpuMs).toBeGreaterThan(10);
  }, 60_000);
});

describe("measureStartupCpuRatio — the CI gate's positive control", () => {
  // A bound proves nothing until something is shown to exceed it. This runs
  // a module that burns CPU while being imported — the regression shape the
  // gate exists to catch — through the exact measurement
  // `describeConformance` uses, and it must blow the ratio a real bundle
  // passes. Unlike the absolute budget this replaced, it must do so on any
  // machine: the reference module it is divided by gets slower too.
  it("reports a violation for a module that burns CPU at import time", async () => {
    const { ratio } = await measureStartupCpuRatio(CPU_HEAVY_SUBJECT_PATH, 3);

    expect(ratio).toBeGreaterThan(MAX_STARTUP_CPU_RATIO);
    const violation = checkStartupCpuRatio(ratio, MAX_STARTUP_CPU_RATIO);
    expect(violation).toBeDefined();
    expect(violation?.maxRatio).toBe(MAX_STARTUP_CPU_RATIO);
  }, 60_000);

  // The two controls are not interchangeable, and this is the evidence:
  // `slow-cold-start-subject.fixture.mjs` takes 400 ms of wall clock and
  // ~1 ms of CPU, so it would sail under the CPU gate. Asserting that here
  // keeps the limitation disclosed in `cold-start.ts`'s header from
  // quietly becoming untrue.
  it("does NOT fire for a subject that is slow without spending CPU — a disclosed gap, pinned", async () => {
    const { ratio } = await measureStartupCpuRatio(SLOW_SUBJECT_PATH, 3);

    expect(ratio).toBeLessThan(MAX_STARTUP_CPU_RATIO);
  }, 60_000);
});

// A server that builds ninety-five input schemas at import legitimately costs
// more CPU to start than one that builds six. The shared maximum ratio stays
// the default for everyone; a package may declare its own, but only openly: a
// reason that is part of the test's title, steps of 0.25, and a hard ceiling
// so the override cannot be used to hollow the gate out.
describe("resolveStartupCpuRatio", () => {
  const REASON = "builds ninety-five input schemas at import, about 16 ms more than a six-tool server";

  it("is the shared maximum when no package overrides it", () => {
    expect(resolveStartupCpuRatio(undefined)).toEqual({ maxRatio: MAX_STARTUP_CPU_RATIO });
    expect(MAX_STARTUP_CPU_RATIO).toBe(2);
  });

  it("takes a documented per-package override, carrying its reason", () => {
    expect(resolveStartupCpuRatio({ max: 2.5, reason: REASON })).toEqual({ maxRatio: 2.5, reason: REASON });
  });

  it("allows a STRICTER maximum than the default, and the ceiling itself", () => {
    expect(resolveStartupCpuRatio({ max: 1.25, reason: REASON }).maxRatio).toBe(1.25);
    expect(resolveStartupCpuRatio({ max: MAX_STARTUP_CPU_RATIO_OVERRIDE, reason: REASON }).maxRatio).toBe(4);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2.1, 4.25, 100])("refuses a maximum of %s", (max) => {
    expect(() => resolveStartupCpuRatio({ max, reason: REASON })).toThrow(/startup CPU ratio/i);
  });

  it.each(["", "   ", "slow", "because", "needs more time"])("refuses the reason %j: an override has to say why, in a sentence", (reason) => {
    expect(() => resolveStartupCpuRatio({ max: 2.5, reason })).toThrow(/reason/i);
  });
});

describe("startupCpuTestTitle", () => {
  it("is exactly the established title for the shared maximum", () => {
    expect(startupCpuTestTitle({ maxRatio: 2 })).toBe("spends at most 2x the reference module's CPU starting up (min of 7 samples each)");
  });

  it("names the override and its reason, so a reader of the test output sees the exception", () => {
    const title = startupCpuTestTitle({ maxRatio: 2.5, reason: "builds ninety-five input schemas at import" });
    expect(title).toContain("2.5x");
    expect(title).toContain("package override");
    expect(title).toContain("builds ninety-five input schemas at import");
  });
});
