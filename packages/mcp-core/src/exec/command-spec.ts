// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Types for the allowlisted command executor (design.md, Decision 4). The
// `Validated` symbol is deliberately NOT exported: the only way to produce a
// value typed `Argv` from outside this module is `validateArgv()`, which
// returns the exact array it validated — never a re-derived copy. Passing a
// raw `string[]` to `runAllowlisted()` is therefore a compile error, not a
// review finding.
import type { z } from "zod";

declare const Validated: unique symbol;

export type Argv = readonly string[] & { readonly [Validated]: true };

export interface CommandSpec<A extends z.ZodTypeAny> {
  /** Fixed binary to execute. Resolved absolute at registration time. */
  readonly bin: string;
  /** The FULL, exact subcommand token list this spec allowlists. */
  readonly subcommand: readonly string[];
  readonly argsSchema: A;
  /** Must return the complete argv, including the subcommand tokens. */
  readonly buildArgv: (args: z.infer<A>) => readonly string[];
  /** Required — no default. */
  readonly timeoutMs: number;
  /** Required — no default. */
  readonly maxOutputBytes: number;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type CommandRejectionReason =
  | "not-allowlisted"
  | "forbidden-command"
  | "schema-invalid"
  | "passthrough-rejected";

export interface CommandRejection {
  readonly reason: CommandRejectionReason;
  readonly message: string;
}

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
