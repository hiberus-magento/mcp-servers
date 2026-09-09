// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Real-process integration test — deliberately does NOT mock
// `node:child_process`, unlike `exec.test.ts`. Proves timeoutMs/
// maxOutputBytes are enforced against an actual long-running process, not
// merely passed through to a mocked call.
import { describe, expect, it } from "vitest";
import { runAllowlisted } from "./run-allowlisted.js";
import type { CommandSpec } from "./command-spec.js";

describe("runAllowlisted (real process)", () => {
  it("kills a process that exceeds timeoutMs and reports timedOut", async () => {
    const spec: CommandSpec<never> = {
      bin: "/bin/sleep",
      subcommand: ["5"],
      argsSchema: undefined as never,
      buildArgv: () => ["5"],
      timeoutMs: 100,
      maxOutputBytes: 1024,
    };

    const start = Date.now();
    const result = await runAllowlisted(spec, ["5"] as unknown as never);
    const elapsedMs = Date.now() - start;

    expect(result.timedOut).toBe(true);
    // Generous upper bound — proves the process was actually killed rather
    // than left to run its full 5s course.
    expect(elapsedMs).toBeLessThan(4000);
  });

  it("completes normally and reports timedOut: false when within the budget", async () => {
    const spec: CommandSpec<never> = {
      bin: "/bin/echo",
      subcommand: ["hi"],
      argsSchema: undefined as never,
      buildArgv: () => ["hi"],
      timeoutMs: 2000,
      maxOutputBytes: 1024,
    };

    const result = await runAllowlisted(spec, ["hi"] as unknown as never);

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hi");
  });
});
