// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Follows the established sibling-gate-script pattern (`verify-bundle.test.mjs`,
// `scan-secrets.test.mjs`): exports its core logic and unit-tests both the
// pass path (ratio within budget) and the fail/trigger path (ratio over
// budget) — a gate must be shown able to fire, not only to stay silent.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundleByteSize, sizeRatio } from "./compare-bundle-size.mjs";

let workDir;

afterEach(() => {
  if (workDir) {
    rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  }
});

function writeFileOfSize(name, byteLength) {
  workDir = workDir ?? mkdtempSync(join(tmpdir(), "compare-bundle-size-test-"));
  const path = join(workDir, name);
  writeFileSync(path, Buffer.alloc(byteLength, "a"));
  return path;
}

describe("bundleByteSize", () => {
  it("reads the real byte size of a file on disk", () => {
    const path = writeFileOfSize("a.js", 1234);
    expect(bundleByteSize(path)).toBe(1234);
  });
});

describe("sizeRatio", () => {
  it("is 0 when the two bundles are the exact same size", () => {
    expect(sizeRatio(1000, 1000)).toBe(0);
  });

  it("is positive when the subject is larger than the reference", () => {
    // Exactly a 25% increase — real arithmetic, not a rounded constant.
    expect(sizeRatio(1250, 1000)).toBeCloseTo(0.25, 10);
  });

  it("is negative when the subject is smaller than the reference", () => {
    expect(sizeRatio(750, 1000)).toBeCloseTo(-0.25, 10);
  });

  it("stays within the 20% no-trigger band for a 10% increase (tasks.md 7.2 branch)", () => {
    const ratio = sizeRatio(1100, 1000);
    expect(Math.abs(ratio)).toBeLessThanOrEqual(0.2);
  });

  it("crosses the 20% re-measure trigger band for a 30% increase (tasks.md 7.3 branch) — proves the gate itself can fire", () => {
    const ratio = sizeRatio(1300, 1000);
    expect(Math.abs(ratio)).toBeGreaterThan(0.2);
  });

  it("throws rather than dividing by zero against an empty reference bundle", () => {
    expect(() => sizeRatio(500, 0)).toThrow(/referenceBytes is 0/);
  });
});
