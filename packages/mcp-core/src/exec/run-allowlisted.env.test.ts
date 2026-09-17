// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Real-process integration test (design.md, Decision 1, Layer 2; tasks.md
// 0.6-0.7) — deliberately does NOT mock `node:child_process`, unlike
// `exec.test.ts`. Proves the child genuinely cannot see the parent's
// environment, for a spec WITH an explicit `env` and one with NONE, and
// carries its own positive control: the same script spawned via plain
// `execFile` with no `env` option DOES see the sentinel, proving this test
// measures something real rather than a sentinel that was never actually
// set (the exact "four disconnected mechanisms" shape this change exists to
// avoid repeating).
import { execFile as nodeExecFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandSpec } from "./command-spec.js";
import { runAllowlisted } from "./run-allowlisted.js";

const execFileAsync = promisify(nodeExecFile);

const SENTINEL_NAME = `MC_SENTINEL_${randomUUID().replaceAll("-", "")}`;
const SENTINEL_VALUE = "sentinel-must-not-cross-the-spawn-boundary";

// Prints the child's OWN env var names — not the values — so this test
// asserts absence/presence of the sentinel KEY, exactly what `Object.keys`
// on the captured `execFile` options also asserts in `exec.test.ts`.
const PRINT_ENV_KEYS_SCRIPT = "process.stdout.write(JSON.stringify(Object.keys(process.env)))";

function sentinelSpec(env?: Readonly<Record<string, string>>): CommandSpec<never> {
  return {
    bin: process.execPath,
    subcommand: ["-e"],
    argsSchema: undefined as never,
    buildArgv: () => ["-e", PRINT_ENV_KEYS_SCRIPT],
    timeoutMs: 2000,
    maxOutputBytes: 4096,
    ...(env ? { env } : {}),
  };
}

describe("runAllowlisted env non-inheritance (real process)", () => {
  beforeAll(() => {
    process.env[SENTINEL_NAME] = SENTINEL_VALUE;
  });

  afterAll(() => {
    delete process.env[SENTINEL_NAME];
  });

  it("hides the parent's sentinel from a spec with NO explicit env", async () => {
    const result = await runAllowlisted(sentinelSpec(), ["-e", PRINT_ENV_KEYS_SCRIPT] as unknown as never);
    const visibleKeys: readonly string[] = JSON.parse(result.stdout);

    expect(visibleKeys).not.toContain(SENTINEL_NAME);
  });

  it("hides the parent's sentinel from a spec WITH an explicit env", async () => {
    const result = await runAllowlisted(
      sentinelSpec({ UNRELATED_VAR: "value" }),
      ["-e", PRINT_ENV_KEYS_SCRIPT] as unknown as never,
    );
    const visibleKeys: readonly string[] = JSON.parse(result.stdout);

    expect(visibleKeys).not.toContain(SENTINEL_NAME);
    expect(visibleKeys).toContain("UNRELATED_VAR");
  });

  it("positive control: the identical script DOES see the sentinel when spawned with no env override at all", async () => {
    // Plain `execFile`, no `env` option — Node's default is to inherit
    // `process.env` wholesale. If this assertion failed, the two tests
    // above would be meaningless: a sentinel that was silently never set
    // would also report "not visible", proving nothing.
    const { stdout } = await execFileAsync(process.execPath, ["-e", PRINT_ENV_KEYS_SCRIPT]);
    const visibleKeys: readonly string[] = JSON.parse(stdout);

    expect(visibleKeys).toContain(SENTINEL_NAME);
  });
});
