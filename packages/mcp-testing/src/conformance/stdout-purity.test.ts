// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Proves the domain-independent fd-1 contamination probe (design.md,
// Decision 1, `fd1-probe-harness.mjs`) actually has teeth, for the two
// mechanisms the "Stdout Purity Assertion" requirement (mcp-conformance
// spec) must jointly cover:
//
//   - `inherit-child` mode is a permanent positive control: it proves fd
//     inheritance is a genuinely detectable hazard, without ever running a
//     real server.
//   - `divert` mode (driven against the real built fixture-server bundle)
//     proves the domain-independent probe stays pure when the stdout guard
//     is genuinely installed.
//   - A hand-rolled contaminating exec subject proves the existing
//     shell-out-based coverage (`shellOutProbe`) is not weakened by any of
//     the above being additive.
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { JsonRpcClient } from "../jsonrpc-client.js";
import { checkStdoutPurity, runFd1DivertProbe } from "./conformance.js";

const HARNESS_PATH = fileURLToPath(new URL("./fd1-probe-harness.mjs", import.meta.url));
const FIXTURE_SERVER_PATH = fileURLToPath(new URL("../../../fixture-server/dist/server.js", import.meta.url));
const NO_GUARD_SUBJECT_PATH = fileURLToPath(new URL("./no-guard-subject.fixture.mjs", import.meta.url));

/** Polls until at least `minCount` raw stdout lines have arrived, or throws. */
async function waitForRawStdoutLines(client: JsonRpcClient, minCount: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (client.rawStdoutLines.length < minCount) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for at least ${minCount} raw stdout line(s); got ${client.rawStdoutLines.length}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Polls until the joined stderr output contains `needle`, or throws. */
async function waitForStderrToContain(client: JsonRpcClient, needle: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!client.stderrChunks.join("").includes(needle)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for stderr to contain ${JSON.stringify(needle)}; got: ${client.stderrChunks.join("")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("fd1-probe-harness.mjs — inherit-child mode (positive control)", () => {
  let client: JsonRpcClient | undefined;

  afterEach(() => {
    client?.close();
    client = undefined;
  });

  it("contaminates stdout via fd inheritance, and checkStdoutPurity reports the violation", async () => {
    client = new JsonRpcClient({ command: process.execPath, args: [HARNESS_PATH, "unused", "inherit-child"] });

    await waitForRawStdoutLines(client, 1);

    const violations = checkStdoutPurity(client.rawStdoutLines);
    expect(violations).toEqual([{ line: "inherit-child-contamination" }]);
  });
});

describe("fd1-probe-harness.mjs — divert mode against the real fixture-server bundle", () => {
  let client: JsonRpcClient | undefined;

  afterEach(() => {
    client?.close();
    client = undefined;
  });

  it("keeps stdout pure and diverts all three contamination attempts to stderr", async () => {
    client = new JsonRpcClient({ command: process.execPath, args: [HARNESS_PATH, FIXTURE_SERVER_PATH, "divert"] });

    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "stdout-purity-test", version: "0.0.0" },
    });
    client.notify("notifications/initialized");
    await client.request("tools/list");

    await waitForStderrToContain(client, "[stdout-diverted] [fd1-probe-harness] contamination attempt: raw Buffer write");

    const violations = checkStdoutPurity(client.rawStdoutLines);
    expect(violations).toEqual([]);

    const stderr = client.stderrChunks.join("");
    expect(stderr).toContain("[stdout-diverted] [fd1-probe-harness] contamination attempt: console.log");
    expect(stderr).toContain("[stdout-diverted] [fd1-probe-harness] contamination attempt: raw string write");
    expect(stderr).toContain("[stdout-diverted] [fd1-probe-harness] contamination attempt: raw Buffer write");
  });
});

describe("runFd1DivertProbe — describeConformance's mandatory, shellOutProbe-independent check", () => {
  it("reports no violations against the real, guard-installed fixture-server bundle", async () => {
    const violations = await runFd1DivertProbe({ serverPath: FIXTURE_SERVER_PATH });
    expect(violations).toEqual([]);
  });

  it("reports one violation per contamination attempt against a subject with no guard installed", async () => {
    const violations = await runFd1DivertProbe({ serverPath: NO_GUARD_SUBJECT_PATH });
    expect(violations).toEqual([
      { line: "[fd1-probe-harness] contamination attempt: console.log" },
      { line: "[fd1-probe-harness] contamination attempt: raw string write" },
      { line: "[fd1-probe-harness] contamination attempt: raw Buffer write" },
    ]);
  });
});
