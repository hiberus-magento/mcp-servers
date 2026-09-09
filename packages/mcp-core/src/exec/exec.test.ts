// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const execFileMock = vi.fn(
  (
    _file: string,
    _args: readonly string[],
    _options: Record<string, unknown>,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    callback(null, "ok", "");
    return new EventEmitter();
  },
);

vi.mock("node:child_process", () => ({
  execFile: (...args: Parameters<typeof execFileMock>) => execFileMock(...args),
}));

const { runAllowlisted } = await import("./run-allowlisted.js");
const { CommandAllowlist, ForbiddenCommandError } = await import("./allowlist.js");
const { validateArgv } = await import("./validate-argv.js");
import type { Argv, CommandSpec } from "./command-spec.js";

function noopSpec(): CommandSpec<never> {
  return {
    bin: "/usr/bin/true",
    subcommand: ["noop"],
    argsSchema: undefined as never,
    buildArgv: () => ["noop"],
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  };
}

// `Argv` is brandable only by `validateArgv` in real code — this cast exists
// solely so this test can exercise `runAllowlisted` (the spawn boundary) in
// isolation, without going through argument validation on every case.
function unsafeArgv(tokens: readonly string[]): Argv {
  return tokens as Argv;
}

describe("runAllowlisted", () => {
  it("spawns the child via execFile with stdio: 'pipe', never 'inherit'", async () => {
    execFileMock.mockClear();
    const spec = noopSpec();
    const argv = unsafeArgv(spec.buildArgv(undefined as never));

    await runAllowlisted(spec, argv);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const call = execFileMock.mock.calls[0];
    if (!call) {
      throw new Error("execFile was not called");
    }
    const options = call[2];
    expect(options.stdio).toBe("pipe");
    expect(options.stdio).not.toBe("inherit");
  });

  it("never shells out — shell: false is always passed to execFile", async () => {
    execFileMock.mockClear();
    const spec = noopSpec();
    const argv = unsafeArgv(spec.buildArgv(undefined as never));

    await runAllowlisted(spec, argv);

    const call = execFileMock.mock.calls[0];
    if (!call) {
      throw new Error("execFile was not called");
    }
    const options = call[2];
    expect(options.shell).toBe(false);
    expect(options.timeout).toBe(1000);
    expect(options.maxBuffer).toBe(1024);
    expect(options.killSignal).toBe("SIGKILL");
  });
});

function statusSpec(): CommandSpec<z.ZodObject<{ porcelain: z.ZodOptional<z.ZodBoolean> }>> {
  const argsSchema = z.object({ porcelain: z.boolean().optional() });
  return {
    bin: "/usr/bin/git",
    subcommand: ["status"],
    argsSchema,
    buildArgv: (args) => (args.porcelain ? ["status", "--porcelain"] : ["status"]),
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  };
}

describe("CommandAllowlist", () => {
  it("resolves an exact full-subcommand match", () => {
    const allowlist = new CommandAllowlist();
    const spec = statusSpec();
    allowlist.register(spec);

    expect(allowlist.resolve("/usr/bin/git", ["status"])).toBe(spec);
  });

  it("does not resolve a prefix-like but distinct subcommand", () => {
    const allowlist = new CommandAllowlist();
    allowlist.register(statusSpec());

    expect(allowlist.resolve("/usr/bin/git", ["status-extended"])).toBeUndefined();
  });

  it("throws at registration time for ssh, tunnel, and db:dump", () => {
    const allowlist = new CommandAllowlist();
    const argsSchema = z.object({});

    for (const forbidden of ["ssh", "tunnel", "db:dump"]) {
      expect(() =>
        allowlist.register({
          bin: `/usr/bin/${forbidden}`,
          subcommand: [],
          argsSchema,
          buildArgv: () => [],
          timeoutMs: 1000,
          maxOutputBytes: 1024,
        }),
      ).toThrow(ForbiddenCommandError);
    }
  });
});

describe("validateArgv", () => {
  it("rejects a schema-invalid argument without building argv", () => {
    const buildArgv = vi.fn(() => ["status"]);
    const spec: CommandSpec<z.ZodObject<{ porcelain: z.ZodBoolean }>> = {
      bin: "/usr/bin/git",
      subcommand: ["status"],
      argsSchema: z.object({ porcelain: z.boolean() }),
      buildArgv,
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    };

    const result = validateArgv(spec, { porcelain: "not-a-boolean" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("schema-invalid");
    }
    expect(buildArgv).not.toHaveBeenCalled();
  });

  it("rejects a '--' passthrough token before any process would spawn", () => {
    const spec: CommandSpec<z.ZodObject<Record<string, never>>> = {
      bin: "/usr/bin/git",
      subcommand: ["status"],
      argsSchema: z.object({}),
      buildArgv: () => ["status", "--", "rm -rf /"],
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    };

    const result = validateArgv(spec, {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("passthrough-rejected");
    }
  });

  it("accepts a valid argument and produces argv for the exact-match happy path", () => {
    const spec = statusSpec();

    const result = validateArgv(spec, { porcelain: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["status", "--porcelain"]);
    }
  });

  it("returns the exact same array buildArgv produced — no normalize-then-execute-raw divergence", async () => {
    execFileMock.mockClear();
    const spec = statusSpec();

    const validated = validateArgv(spec, { porcelain: true });
    if (!validated.ok) {
      throw new Error("expected validation to succeed");
    }

    await runAllowlisted(spec as CommandSpec<never>, validated.value);

    const call = execFileMock.mock.calls[0];
    if (!call) {
      throw new Error("execFile was not called");
    }
    const executedArgv = call[1];
    // Byte-identical: the exact array validateArgv returned is what
    // execFile actually received, not a re-derived copy.
    expect(executedArgv).toBe(validated.value);
    expect(executedArgv).toEqual(["status", "--porcelain"]);
  });
});
