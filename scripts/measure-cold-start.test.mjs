// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Unit coverage for the pure `percentile()` statistic, plus one small
// real-process integration test proving `measureColdStart` genuinely spawns,
// times, and kills — using `fixture-server`'s own already-built bundle
// (read-only) as the subject, with a deliberately small sample size to keep
// this test fast. The real 20-sample eds measurement is a manual/CI step
// (`node scripts/measure-cold-start.mjs packages/eds dist/mcp.js`), not part
// of the fast test suite.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { measureColdStart, percentile } from "./measure-cold-start.mjs";

describe("percentile", () => {
  it("returns the exact value for a single-sample set at any percentile", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it("computes p50 (median) for an odd-length sorted set", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it("computes p95 using nearest-rank, not interpolation", () => {
    // 20 samples 1..20: ceil(0.95 * 20) = 19th smallest = 19.
    const samples = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(samples, 95)).toBe(19);
  });

  it("does not depend on input order", () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(percentile([1, 2, 3, 4, 5], 50));
  });

  it("throws on an empty sample set rather than returning undefined silently", () => {
    expect(() => percentile([], 50)).toThrow(/empty sample set/);
  });
});

const FIXTURE_SERVER_BUNDLE = fileURLToPath(new URL("../packages/fixture-server/dist/server.js", import.meta.url));

describe.skipIf(!existsSync(FIXTURE_SERVER_BUNDLE))("measureColdStart — real-process integration (fixture-server bundle)", () => {
  it("produces one sample per iteration and a p50/p95 within the observed range", async () => {
    const result = await measureColdStart(FIXTURE_SERVER_BUNDLE, { sampleCount: 5, discardCount: 1 });

    expect(result.all).toHaveLength(5);
    expect(result.discarded).toHaveLength(1);
    expect(result.retained).toHaveLength(4);
    for (const ms of result.all) {
      expect(ms).toBeGreaterThan(0);
      expect(Number.isFinite(ms)).toBe(true);
    }
    expect(result.p50).toBeGreaterThanOrEqual(Math.min(...result.retained));
    expect(result.p95).toBeLessThanOrEqual(Math.max(...result.retained));
  }, 30_000);

  it("rejects when discardCount is not less than sampleCount", async () => {
    await expect(measureColdStart(FIXTURE_SERVER_BUNDLE, { sampleCount: 3, discardCount: 3 })).rejects.toThrow(/discardCount/);
  });
});
