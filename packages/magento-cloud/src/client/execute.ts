// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The single shared spawn-and-classify path (design.md, Decisions 2 and 6).
// Every CLI subcommand (`cli.ts`) and every MCP tool handler
// (`tools/magento-cloud-tools.ts`) runs an allowlisted command through this
// exact function — never `runAllowlisted` directly — so the correction
// found in batch 2's real-process testing lands in exactly one place:
//
// VERIFIED CORRECTION (Node v22.14.0, `classify.timeout.test.ts`): a real
// `maxBuffer` overflow does NOT set `CommandResult.timedOut` — it does not
// set `error.killed`/`error.signal` at all. design.md's Decision 6 assumed
// both a wall-clock timeout and a byte-cap overflow shared the same kill
// signal; they do not. A caller that only invokes `classifyKill` when
// `timedOut === true` therefore MISSES every byte-cap kill on every
// command, not only `db:sql` — it would report a generic, unhelpful
// "exited with code 1" instead of the explainable output-cap/timeout
// message. `classifyKill` is invoked here whenever `exitCode !== 0`,
// unconditionally.
import type { z } from "zod";
import { runAllowlisted, validateArgv, type CommandSpec } from "@hiberus-magento/mcp-core";
import { classifyCliFailure, classifyKill } from "./classify.js";

export type MagentoCloudFailureKind =
  | "rejected"
  | "not-authenticated"
  | "output-cap-exceeded"
  | "timed-out"
  | "resource-limit-exceeded"
  | "generic";

export class MagentoCloudCommandFailedError extends Error {
  readonly kind: MagentoCloudFailureKind;

  constructor(kind: MagentoCloudFailureKind, message: string) {
    super(message);
    this.name = "MagentoCloudCommandFailedError";
    this.kind = kind;
  }
}

export interface ExecuteReadOnlyCommandInput<A extends z.ZodTypeAny> {
  readonly spec: CommandSpec<A>;
  readonly rawArgs: unknown;
  /** Injected clock, never `Date.now()` read directly — mirrors `classify.ts`'s own discipline. */
  readonly now: () => number;
}

/**
 * Validates, spawns, and classifies exactly once. Returns the raw stdout
 * string on success (`exitCode === 0`); throws `MagentoCloudCommandFailedError`
 * for every other outcome, named by `kind` so a caller (an MCP tool handler,
 * `invokeMagentoCloudTool`) can surface a distinguishable `isError: true`
 * result instead of an opaque failure.
 */
export async function executeReadOnlyCommand<A extends z.ZodTypeAny>(input: ExecuteReadOnlyCommandInput<A>): Promise<string> {
  const validated = validateArgv(input.spec, input.rawArgs);
  if (!validated.ok) {
    // A schema-invalid argument set — including a db:sql guard rejection,
    // which is wired as this exact spec's own `argsSchema.transform()`
    // (design.md, Decision 5) — never reaches `execFile` at all.
    throw new MagentoCloudCommandFailedError("rejected", validated.error.message);
  }

  const start = input.now();
  const result = await runAllowlisted(input.spec as CommandSpec<never>, validated.value);
  const elapsedMs = input.now() - start;

  if (result.exitCode === 0) {
    return result.stdout;
  }

  const authFailure = classifyCliFailure({ exitCode: result.exitCode, stderr: result.stderr });
  if (authFailure.kind === "not-authenticated") {
    throw new MagentoCloudCommandFailedError("not-authenticated", authFailure.message);
  }

  const kill = classifyKill({
    elapsedMs,
    stdout: result.stdout,
    stderr: result.stderr,
    timeoutMs: input.spec.timeoutMs,
    maxOutputBytes: input.spec.maxOutputBytes,
  });
  if (kill.kind !== "killed-unclassified") {
    throw new MagentoCloudCommandFailedError(kill.kind, kill.message);
  }

  // Neither cap was reached: this was never a kill at all, only an ordinary
  // non-zero exit (e.g. an invalid project id). Fall back to the generic
  // classification, which carries the CLI's own real stderr text.
  throw new MagentoCloudCommandFailedError("generic", authFailure.message);
}
