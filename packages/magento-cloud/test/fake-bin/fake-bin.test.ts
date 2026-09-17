// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Real-process characterization tests for the checked-in fake `magento-cloud`
// binary itself (design.md, Decision 8; tasks.md 1.5, 1.6). This is
// test-infrastructure, not domain production code: the fake is created by
// the same task that these tests characterize (tasks.md 1.4-1.6 are ordered
// together deliberately, per the task list's own sequencing), so these
// assertions guard against silent regressions in the fixture — a clone or a
// patch that loses the executable bit, or an argv-matching change that
// starts returning empty output instead of failing loudly.
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const FAKE_BIN = join(dirname(fileURLToPath(import.meta.url)), "magento-cloud");

describe("fake-bin executable mode", () => {
  it("keeps the executable bit set (0o111), so a mode-bit loss fails loudly", () => {
    const mode = statSync(FAKE_BIN).mode;

    expect(mode & 0o111).not.toBe(0);
  });
});

describe("fake-bin unknown-argv contract", () => {
  it("exits 2 with the argv echoed on stderr for an unrecognized command", async () => {
    await expect(execFileAsync(FAKE_BIN, ["project:frobnicate", "--nope"])).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining(JSON.stringify(["project:frobnicate", "--nope"])),
    });
  });

  it("resolves the KNOWN auth:info argv to the canned fixture, as the contrast case", async () => {
    // UPDATED at Phase 9 (tasks.md 9.1-9.2): the real `authInfoSpec` built
    // by `commands.ts` always appends `--format=tsv` (`withFormatTsv`) —
    // this test originally used the Phase 1 argv, written before that
    // decision existed, and drifted from the corpus's own KNOWN_ARGV entry
    // once it was corrected for the conformance suite's real spawn.
    const { stdout } = await execFileAsync(FAKE_BIN, ["auth:info", "--no-auto-login", "--format=tsv"]);

    expect(stdout).toContain("acct-demo-0001");
  });
});
