// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 3; tasks.md 3.1): the read-only and
// forbidden subcommand key sets cannot overlap at COMPILE time, not merely
// by runtime coincidence. Run under `vitest --typecheck` (never executed).
import { test } from "vitest";
import { FORBIDDEN_SUBCOMMANDS, READ_ONLY_SUBCOMMANDS } from "./commands.js";

type ReadOnlyKey = (typeof READ_ONLY_SUBCOMMANDS)[number][0];
type ForbiddenKey = (typeof FORBIDDEN_SUBCOMMANDS)[number][0];

// `AssertNever` only accepts `never`. If a subcommand token ever appears on
// BOTH literals, `Extract<ReadOnlyKey, ForbiddenKey>` stops being `never`
// and this line fails to compile — the positive control for this file: a
// deliberately overlapping literal (e.g. adding `["db:dump"]` to
// `READ_ONLY_SUBCOMMANDS`) makes `_NoOverlap` fail to typecheck.
type AssertNever<T extends never> = T;
type _NoOverlap = AssertNever<Extract<ReadOnlyKey, ForbiddenKey>>;

test("no subcommand key can be registered as both read-only and forbidden", () => {
  const proof: _NoOverlap = undefined as never;
  void proof;
});
