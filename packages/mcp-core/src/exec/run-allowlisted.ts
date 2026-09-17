// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The spawn boundary of the allowlisted command executor (design.md,
// Decision 4; M4 in Decision 2's stdout-safety table). Always `execFile`,
// never `exec`; always `shell: false`; always `stdio: 'pipe'`, never
// `'inherit'` — the only mechanism that closes the child-fd-1-inheritance
// gap M1 cannot close on its own.
import { execFile, type ExecException, type ExecFileOptions } from "node:child_process";
import type { Argv, CommandResult, CommandSpec } from "./command-spec.js";

// `execFile`'s own type declarations do not include `stdio` — Node ignores
// unknown option keys, and `execFile` always pipes stdout/stderr internally
// to build the callback's buffers, so an inherited fd 1 is not reachable
// through this call at all. We still pass it explicitly: it documents the
// M4 invariant at the call site and is asserted on directly by the exec
// test, so a future refactor to `spawn` cannot silently drop it.
interface AllowlistedExecOptions extends ExecFileOptions {
  readonly stdio: "pipe";
  // Narrower than `ExecFileOptions["env"]` (design.md, Decision 1): a
  // required, non-optional `Readonly<Record<string, string>>` — never
  // `NodeJS.ProcessEnv`, whose index signature (`string | undefined`) is
  // exactly what would let `process.env` slip in here. Do NOT add an eslint
  // `no-restricted-syntax` ban on `process.env` under this glob instead —
  // `eslint.config.js`'s existing `src/exec/**` block already carries its
  // own `no-restricted-syntax` array, and flat config merges same-named
  // rules by last-match-wins, not by union, so a second block would
  // silently delete the regex/prefix/substring bans (tasks.md 0.11).
  readonly env: Readonly<Record<string, string>>;
}

type ExecFileError = ExecException & {
  readonly killed?: boolean;
};

export function runAllowlisted(spec: CommandSpec<never>, argv: Argv): Promise<CommandResult> {
  return new Promise((resolve) => {
    const options: AllowlistedExecOptions = {
      shell: false,
      stdio: "pipe",
      timeout: spec.timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: spec.maxOutputBytes,
      // Never `process.env` wholesale — an allowlisted command runs with an
      // explicit, minimal environment. Spreading into a fresh object literal
      // means Node receives a COPY, never the caller's own (possibly frozen)
      // record, and a spec supplying no `env` still spawns with exactly `{}`,
      // byte-identical to this executor's behavior before `CommandSpec.env`
      // existed.
      env: { ...spec.env },
    };

    execFile(
      spec.bin,
      argv as unknown as string[],
      options,
      (error: ExecFileError | null, stdout: string | Buffer, stderr: string | Buffer) => {
        const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({
          exitCode,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          timedOut: Boolean(error?.killed && error.signal === "SIGKILL"),
        });
      },
    );
  });
}
