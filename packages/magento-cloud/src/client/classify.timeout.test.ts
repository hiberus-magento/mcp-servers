// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.8). Real-process integration test — deliberately
// does NOT mock `node:child_process` (mirrors
// `packages/mcp-core/src/exec/run-allowlisted.timeout.test.ts`): two tests
// differing ONLY in which limit the checked-in fake binary exceeds,
// proving `classifyKill` disambiguates a REAL byte-cap kill from a REAL
// wall-clock kill, not merely two crafted numbers.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAllowlisted } from "@hiberus-magento/mcp-core";
import { describe, expect, it } from "vitest";
import { classifyKill } from "./classify.js";
import { locateBinary } from "./locate-binary.js";
import type { CommandSpec } from "@hiberus-magento/mcp-core";

const FAKE_BIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../test/fake-bin");
const FAKE_BIN = locateBinary({ binaryName: "magento-cloud", pathEntries: [FAKE_BIN_DIR] });

function specFor(subcommand: readonly string[], input: { readonly timeoutMs: number; readonly maxOutputBytes: number }): CommandSpec<never> {
  if (FAKE_BIN === undefined) {
    throw new Error("expected the checked-in fake binary to resolve");
  }
  return {
    bin: FAKE_BIN,
    subcommand,
    argsSchema: undefined as never,
    buildArgv: () => [...subcommand],
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes,
    // The fake binary's `#!/usr/bin/env node` shebang needs `PATH` to
    // locate `node` itself — an empty child env (this spec's default
    // absent `env`) makes `env` fail with exit 127 immediately, which this
    // test caught for real: both cases failed near-instantly with
    // `timedOut: false` until this was added. `process.env.PATH` is read
    // here, in TEST setup, never inside `client/` production code.
    env: { PATH: process.env.PATH ?? "" },
  };
}

describe("classifyKill against a REAL spawn of the fake binary", () => {
  it("__flood exceeding a small maxOutputBytes classifies output-cap-exceeded", async () => {
    const timeoutMs = 5000;
    const maxOutputBytes = 4096;
    const spec = specFor(["__flood", "1000000"], { timeoutMs, maxOutputBytes });

    const start = Date.now();
    const result = await runAllowlisted(spec, ["__flood", "1000000"] as unknown as never);
    const elapsedMs = Date.now() - start;

    // VERIFIED DEVIATION FROM design.md's Decision 6 ASSUMPTION, found by
    // running this real spawn on Node v22.14.0: design.md states "Node
    // uses the same killSignal for a maxBuffer overflow" as a real
    // timeout, implying `CommandResult.timedOut` would be `true` for BOTH
    // causes. It is NOT. `execFile`'s maxBuffer overflow does not set
    // `error.killed`/`error.signal` at all — `run-allowlisted.ts`'s
    // `timedOut: Boolean(error?.killed && error.signal === "SIGKILL")`
    // stays `false`, and `error.code` is the STRING
    // `"ERR_CHILD_PROCESS_STDIO_MAXBUFFER"`, which the existing
    // `typeof error.code === "number" ? error.code : 1` collapse turns
    // into a generic `exitCode: 1` — captured here as the REAL evidence,
    // not asserted from the design doc's unverified claim.
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.length).toBe(maxOutputBytes);
    expect(elapsedMs).toBeLessThan(timeoutMs);

    const classification = classifyKill({ elapsedMs, stdout: result.stdout, stderr: result.stderr, timeoutMs, maxOutputBytes });

    expect(classification.kind).toBe("output-cap-exceeded");
  });

  it("__slow exceeding a small timeoutMs classifies timed-out", async () => {
    const timeoutMs = 200;
    const maxOutputBytes = 1_048_576;
    const spec = specFor(["__slow", "5000"], { timeoutMs, maxOutputBytes });

    const start = Date.now();
    const result = await runAllowlisted(spec, ["__slow", "5000"] as unknown as never);
    const elapsedMs = Date.now() - start;

    expect(result.timedOut).toBe(true);
    // Generous upper bound — proves the process was actually killed rather
    // than left to run its full 5s course.
    expect(elapsedMs).toBeLessThan(4000);

    const classification = classifyKill({ elapsedMs, stdout: result.stdout, stderr: result.stderr, timeoutMs, maxOutputBytes });

    expect(classification.kind).toBe("timed-out");
  });
});
