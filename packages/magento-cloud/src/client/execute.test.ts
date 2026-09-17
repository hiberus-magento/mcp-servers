// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md, Phase 7/8 groundwork). `executeReadOnlyCommand` is
// the single shared spawn-and-classify path every CLI subcommand and every
// MCP tool handler goes through, so the VERIFIED correction from batch 2's
// `classify.timeout.test.ts` lands in exactly one place: `classifyKill` is
// consulted whenever `exitCode !== 0`, never gated on `timedOut === true`
// (design.md's Decision 6 assumption that both causes share the same
// `timedOut` signal is FALSE on Node v22.14.0 — see `classify.ts`'s own
// doc comment). Without this, a byte-cap kill on ANY allowlisted command —
// not only `db:sql` — would collapse into an unhelpful generic
// "exited with code 1" instead of the explainable cap/timeout message.
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CommandSpec } from "@hiberus-magento/mcp-core";
import { MagentoCloudCommandFailedError, executeReadOnlyCommand } from "./execute.js";

type ExecFileCallback = (error: (Error & { readonly code?: number | string }) | null, stdout: string, stderr: string) => void;

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: Parameters<typeof execFileMock>) => execFileMock(...args),
}));

function mockExecFileOnce(exitCode: number, stdout: string, stderr: string): void {
  execFileMock.mockImplementationOnce((_file: string, _args: readonly string[], _options: Record<string, unknown>, callback: ExecFileCallback) => {
    if (exitCode === 0) {
      callback(null, stdout, stderr);
    } else {
      const error = Object.assign(new Error(`exit ${exitCode}`), { code: exitCode }) as Error & { code: number };
      callback(error, stdout, stderr);
    }
    return new EventEmitter();
  });
}

const argsSchema = z.object({ query: z.string().min(1) }).strict();

function buildSpec(overrides?: Partial<CommandSpec<typeof argsSchema>>): CommandSpec<typeof argsSchema> {
  return {
    bin: "/usr/bin/magento-cloud",
    subcommand: ["db:sql"],
    argsSchema,
    buildArgv: (args) => ["db:sql", "--raw", args.query],
    timeoutMs: 1000,
    maxOutputBytes: 1024,
    ...overrides,
  };
}

describe("executeReadOnlyCommand — success", () => {
  it("returns stdout verbatim on exit 0", async () => {
    mockExecFileOnce(0, "row1\trow2\n", "");
    const spec = buildSpec();

    const stdout = await executeReadOnlyCommand({ spec, rawArgs: { query: "SELECT id FROM t" }, now: () => 0 });

    expect(stdout).toBe("row1\trow2\n");
  });
});

describe("executeReadOnlyCommand — schema rejection never spawns", () => {
  it("throws a 'rejected' MagentoCloudCommandFailedError and never calls execFile", async () => {
    const spec = buildSpec();

    await expect(executeReadOnlyCommand({ spec, rawArgs: { query: "" }, now: () => 0 })).rejects.toThrow(MagentoCloudCommandFailedError);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe("executeReadOnlyCommand — not-authenticated classification", () => {
  it("classifies the real non-interactive auth-help stderr as not-authenticated", async () => {
    mockExecFileOnce(1, "", "Not logged in.\nTo authenticate non-interactively, configure an API token.");
    const spec = buildSpec();

    const failure = await executeReadOnlyCommand({ spec, rawArgs: { query: "SELECT id FROM t" }, now: () => 0 }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MagentoCloudCommandFailedError);
    expect((failure as MagentoCloudCommandFailedError).kind).toBe("not-authenticated");
  });
});

// THE CORRECTION: classifyKill is consulted on exitCode !== 0 REGARDLESS of
// timedOut. A mocked maxBuffer overflow (Node's real behaviour, verified in
// batch 2) never sets `error.killed`/`error.signal`, so `runAllowlisted`
// reports `timedOut: false` even though the byte cap was actually hit.
describe("executeReadOnlyCommand — output-cap classification independent of timedOut", () => {
  it("classifies output-cap-exceeded from a plain exit-1 with no killed/signal, matching maxOutputBytes", async () => {
    const maxOutputBytes = 16;
    const cappedStdout = "x".repeat(maxOutputBytes);
    mockExecFileOnce(1, cappedStdout, "");
    const spec = buildSpec({ maxOutputBytes });

    const failure = await executeReadOnlyCommand({ spec, rawArgs: { query: "SELECT id FROM t" }, now: () => 0 }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MagentoCloudCommandFailedError);
    expect((failure as MagentoCloudCommandFailedError).kind).toBe("output-cap-exceeded");
  });

  it("classifies timed-out from a plain exit-1 whose elapsed time reached the time budget", async () => {
    mockExecFileOnce(1, "", "");
    const spec = buildSpec({ timeoutMs: 1000 });
    let call = 0;
    const now = () => {
      call += 1;
      return call === 1 ? 0 : 950; // 95% of the 1000ms budget
    };

    const failure = await executeReadOnlyCommand({ spec, rawArgs: { query: "SELECT id FROM t" }, now }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MagentoCloudCommandFailedError);
    expect((failure as MagentoCloudCommandFailedError).kind).toBe("timed-out");
  });

  it("falls back to the generic classification (real stderr) when neither cap was reached — an ordinary CLI error, not a kill", async () => {
    mockExecFileOnce(1, "", "invalid project id");
    const spec = buildSpec();

    const failure = await executeReadOnlyCommand({ spec, rawArgs: { query: "SELECT id FROM t" }, now: () => 0 }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MagentoCloudCommandFailedError);
    expect((failure as MagentoCloudCommandFailedError).kind).toBe("generic");
    expect((failure as MagentoCloudCommandFailedError).message).toContain("invalid project id");
  });
});
