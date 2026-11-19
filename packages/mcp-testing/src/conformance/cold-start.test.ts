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
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COLD_START_BUDGET_MS,
  STARTUP_CPU_BUDGET_MS,
  checkColdStart,
  checkStartupCpu,
  measureMedianColdStart,
  measureStartupCpu,
  resolveStartupCpuBudget,
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

describe("checkStartupCpu", () => {
  it("passes at or under the budget", () => {
    expect(checkStartupCpu(40, 75)).toBeUndefined();
    expect(checkStartupCpu(75, 75)).toBeUndefined();
  });

  it("fails and reports both figures over the budget", () => {
    expect(checkStartupCpu(90, 75)).toEqual({ cpuMs: 90, budgetMs: 75 });
  });
});

describe("measureStartupCpu — the CI gate's positive control", () => {
  // A bound proves nothing until something is shown to exceed it. This runs
  // a module that burns CPU while being imported — the regression shape the
  // budget exists to catch — through the exact harness `describeConformance`
  // uses, and it must blow the budget a real bundle passes.
  it("reports a violation for a module that burns CPU at import time", async () => {
    const { minCpuMs } = await measureStartupCpu(CPU_HEAVY_SUBJECT_PATH, 3);

    expect(minCpuMs).toBeGreaterThan(STARTUP_CPU_BUDGET_MS);
    const violation = checkStartupCpu(minCpuMs, STARTUP_CPU_BUDGET_MS);
    expect(violation).toBeDefined();
    expect(violation?.budgetMs).toBe(STARTUP_CPU_BUDGET_MS);
  }, 60_000);

  // The two controls are not interchangeable, and this is the evidence:
  // `slow-cold-start-subject.fixture.mjs` takes 400 ms of wall clock and
  // ~1 ms of CPU, so it would sail under the CPU gate. Asserting that here
  // keeps the limitation disclosed in `cold-start.ts`'s header from
  // quietly becoming untrue.
  it("does NOT fire for a subject that is slow without spending CPU — a disclosed gap, pinned", async () => {
    const { minCpuMs } = await measureStartupCpu(SLOW_SUBJECT_PATH, 3);

    expect(minCpuMs).toBeLessThan(STARTUP_CPU_BUDGET_MS);
  }, 30_000);
});

// A server that builds ninety-five input schemas at import legitimately costs
// more CPU to start than one that builds six. The shared 75 ms stays the
// default for everyone; a package may declare its own, but only openly: a
// reason that is part of the test's title, an integer, and a hard ceiling so
// the override cannot be used to hollow the gate out.
describe("resolveStartupCpuBudget", () => {
  const REASON = "builds ninety-five input schemas at import, about 16 ms more than a six-tool server";

  it("is the shared budget when no package overrides it", () => {
    expect(resolveStartupCpuBudget(undefined)).toEqual({ budgetMs: STARTUP_CPU_BUDGET_MS });
    expect(STARTUP_CPU_BUDGET_MS).toBe(75);
  });

  it("takes a documented per-package override, carrying its reason", () => {
    expect(resolveStartupCpuBudget({ ms: 100, reason: REASON })).toEqual({ budgetMs: 100, reason: REASON });
  });

  it("allows a STRICTER budget than the default, and the ceiling itself", () => {
    expect(resolveStartupCpuBudget({ ms: 50, reason: REASON }).budgetMs).toBe(50);
    expect(resolveStartupCpuBudget({ ms: 200, reason: REASON }).budgetMs).toBe(200);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 75.5, 201, 10_000])("refuses a budget of %s ms", (ms) => {
    expect(() => resolveStartupCpuBudget({ ms, reason: REASON })).toThrow(/startup CPU budget/i);
  });

  it.each(["", "   ", "slow", "because", "needs more time"])("refuses the reason %j: an override has to say why, in a sentence", (reason) => {
    expect(() => resolveStartupCpuBudget({ ms: 100, reason })).toThrow(/reason/i);
  });
});

describe("startupCpuTestTitle", () => {
  it("is exactly the established title for the shared budget", () => {
    expect(startupCpuTestTitle({ budgetMs: 75 })).toBe("spends at or under 75 ms of CPU starting up (min of 7 samples)");
  });

  it("names the override and its reason, so a reader of the test output sees the exception", () => {
    const title = startupCpuTestTitle({ budgetMs: 100, reason: "builds ninety-five input schemas at import" });
    expect(title).toContain("100 ms");
    expect(title).toContain("package override");
    expect(title).toContain("builds ninety-five input schemas at import");
  });
});
