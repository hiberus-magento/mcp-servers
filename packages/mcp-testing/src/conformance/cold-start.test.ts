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
import { COLD_START_BUDGET_MS, checkColdStart, measureMedianColdStart } from "./cold-start.js";

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

describe("measureMedianColdStart + checkColdStart — proves the assertion fires against a genuinely slow subject", () => {
  it("reports a violation for a subject slower than COLD_START_BUDGET_MS", async () => {
    const { medianMs } = await measureMedianColdStart(SLOW_SUBJECT_PATH, 3);

    expect(medianMs).toBeGreaterThan(COLD_START_BUDGET_MS);
    const violation = checkColdStart(medianMs, COLD_START_BUDGET_MS);
    expect(violation).toBeDefined();
    expect(violation?.budgetMs).toBe(COLD_START_BUDGET_MS);
  }, 15_000);
});
