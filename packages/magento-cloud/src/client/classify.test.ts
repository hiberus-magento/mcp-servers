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
  classifyCliFailure,
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
