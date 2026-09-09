// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The sole producer of `Argv` (design.md, Decision 4). Every argument is
// validated against its declared zod schema before `buildArgv` ever runs;
// a schema failure returns a rejection and `buildArgv` is never called. The
// built argv is scanned for a `--` passthrough token and, on success,
// returned exactly as `buildArgv` produced it — never a re-derived copy —
// so the value the caller executes is provably the value that was
// validated.
import type { z } from "zod";
import type { Argv, CommandRejection, CommandSpec, Result } from "./command-spec.js";

const PASSTHROUGH_TOKEN = "--";

export function validateArgv<A extends z.ZodTypeAny>(
  spec: CommandSpec<A>,
  raw: unknown,
): Result<Argv, CommandRejection> {
  const parsed = spec.argsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        reason: "schema-invalid",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      },
    };
  }

  const argv = spec.buildArgv(parsed.data);
  const hasPassthrough = argv.some((token) => token === PASSTHROUGH_TOKEN);
  if (hasPassthrough) {
    return {
      ok: false,
      error: {
        reason: "passthrough-rejected",
        message: `Argument list contains a "${PASSTHROUGH_TOKEN}" passthrough token.`,
      },
    };
  }

  return { ok: true, value: argv as Argv };
}
