// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

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
