// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// (design.md, Decision 2; magento-cloud-client spec, "CLI-Failure
// Classification..."; tasks.md 2.4, 2.6, 2.8-2.9.)
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MINIMUM_SUPPORTED_CLI_VERSION,
  TIME_ATTRIBUTION_FACTOR,
  classifyCliFailure,
  classifyKill,
  ensureBinaryResolved,
  parseCliVersion,
  resetCliVersionMemoForTests,
  resolveCliVersionInfo,
} from "./classify.js";
import { MagentoCloudNotInstalledError } from "./errors.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../test/fake-bin/fixtures");
const NOT_AUTHENTICATED_STDERR = readFileSync(join(FIXTURES_DIR, "not-authenticated.txt"), "utf8");

describe("ensureBinaryResolved — the ENOENT trap is unreachable", () => {
  beforeEach(() => {
    vi.mocked(execFile).mockClear();
  });

  it("throws MagentoCloudNotInstalledError and never calls execFile when no binary resolves", () => {
    expect(() => ensureBinaryResolved({ binaryName: "magento-cloud", pathEntries: ["/nonexistent/dir"] })).toThrow(
      MagentoCloudNotInstalledError,
    );
    expect(execFile).not.toHaveBeenCalled();
  });

  it("returns the resolved absolute path when the binary IS found (contrast case)", () => {
    const fakeBinDir = join(dirname(fileURLToPath(import.meta.url)), "../../test/fake-bin");

    const resolved = ensureBinaryResolved({ binaryName: "magento-cloud", pathEntries: [fakeBinDir] });

    expect(resolved).toBe(join(fakeBinDir, "magento-cloud"));
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe("classifyCliFailure", () => {
  it("classifies the real captured non-interactive auth-help stderr as not-authenticated", () => {
    const result = classifyCliFailure({ exitCode: 1, stderr: NOT_AUTHENTICATED_STDERR });

    expect(result.kind).toBe("not-authenticated");
    expect(result.message).toContain("MAGENTO_CLOUD_CLI_TOKEN");
  });

  it("classifies an unrelated failure as generic, distinct from not-authenticated", () => {
    const result = classifyCliFailure({ exitCode: 1, stderr: "some other unrelated CLI error" });

    expect(result.kind).toBe("generic");
    if (result.kind === "generic") {
      expect(result.exitCode).toBe(1);
    }
  });

  it("never classifies an exit-0 result as not-authenticated, even if the text matched", () => {
    const result = classifyCliFailure({ exitCode: 0, stderr: "Not logged in" });

    expect(result.kind).toBe("generic");
  });
});

describe("CLI version parsing and memoization", () => {
  beforeEach(() => {
    resetCliVersionMemoForTests();
  });

  it("parses a real-format version string", () => {
    expect(parseCliVersion("Magento Cloud CLI 1.47.0")).toBe("1.47.0");
  });

  it("records 'unknown' for an unparseable version string, without throwing", () => {
    expect(() => parseCliVersion("garbled nonsense output")).not.toThrow();
    expect(parseCliVersion("garbled nonsense output")).toBe("unknown");
  });

  it("memoizes: a second call with a DIFFERENT raw string still returns the first result", () => {
    const first = resolveCliVersionInfo("Magento Cloud CLI 1.47.0");
    const second = resolveCliVersionInfo("Magento Cloud CLI 99.0.0");

    expect(first.parsed).toBe("1.47.0");
    expect(second).toBe(first);
    expect(second.parsed).toBe("1.47.0");
  });

  it("treats an unparseable version as supported: true (advisory, never blocking)", () => {
    const info = resolveCliVersionInfo("garbled nonsense output");

    expect(info.parsed).toBe("unknown");
    expect(info.supported).toBe(true);
  });

  it("marks the confirmed minimum version itself as supported", () => {
    const info = resolveCliVersionInfo(`Magento Cloud CLI ${MINIMUM_SUPPORTED_CLI_VERSION}`);

    expect(info.supported).toBe(true);
  });

  it("marks a version below the confirmed minimum as unsupported (advisory only)", () => {
    const info = resolveCliVersionInfo("Magento Cloud CLI 0.1.0");

    expect(info.supported).toBe(false);
  });
});

// RED-first (tasks.md 6.8-6.10): a `maxBuffer` overflow and a real
// `timeoutMs` kill both surface through the SAME `SIGKILL` signal
// (design.md, Decision 6) — `classifyKill` disambiguates using an injected
// clock and captured output length, never guessing when genuinely
// ambiguous. Pure decision function: the REAL-PROCESS proof that a fake-bin
// `__flood`/`__slow` invocation actually produces these two different
// input shapes lives in `classify.timeout.test.ts`, which cannot mock
// `node:child_process` the way this file does.
describe("classifyKill — timeout vs output-cap disambiguation", () => {
  const timeoutMs = 1000;
  const maxOutputBytes = 1024;

  it("classifies output-cap-exceeded when only the byte cap was reached", () => {
    const result = classifyKill({
      elapsedMs: 50,
      stdout: "x".repeat(maxOutputBytes),
      stderr: "",
      timeoutMs,
      maxOutputBytes,
    });

    expect(result.kind).toBe("output-cap-exceeded");
  });

  it("classifies timed-out when only the time budget was reached", () => {
    const result = classifyKill({
      elapsedMs: timeoutMs * TIME_ATTRIBUTION_FACTOR,
      stdout: "tiny",
      stderr: "",
      timeoutMs,
      maxOutputBytes,
    });

    expect(result.kind).toBe("timed-out");
  });

  it("classifies resource-limit-exceeded and names BOTH causes when both conditions hold", () => {
    const result = classifyKill({
      elapsedMs: timeoutMs * TIME_ATTRIBUTION_FACTOR,
      stdout: "x".repeat(maxOutputBytes),
      stderr: "",
      timeoutMs,
      maxOutputBytes,
    });

    expect(result.kind).toBe("resource-limit-exceeded");
    expect(result.message).toMatch(/output/i);
    expect(result.message).toMatch(/time|timeout/i);
  });

  it("classifies killed-unclassified and names both when NEITHER signal fired, stating the cause could not be attributed", () => {
    const result = classifyKill({
      elapsedMs: 10,
      stdout: "tiny",
      stderr: "",
      timeoutMs,
      maxOutputBytes,
    });

    expect(result.kind).toBe("killed-unclassified");
    expect(result.message).toMatch(/could not/i);
  });

  it("measures stdout and stderr SEPARATELY, taking the max — a large stderr alone can trip the byte cap", () => {
    const result = classifyKill({
      elapsedMs: 50,
      stdout: "tiny",
      stderr: "x".repeat(maxOutputBytes),
      timeoutMs,
      maxOutputBytes,
    });

    expect(result.kind).toBe("output-cap-exceeded");
  });
});
