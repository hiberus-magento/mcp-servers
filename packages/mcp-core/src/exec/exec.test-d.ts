// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 1, Layer 1; tasks.md 0.1): `env:
// process.env` and its spread form are unconstructible against
// `CommandSpec.env`'s `Readonly<Record<string, string>>` type, because
// `NodeJS.ProcessEnv`'s index signature is `string | undefined`, which is
// not assignable to `string` under this repo's `strict: true`. Never
// executed — type-checked only, under `vitest --typecheck`
// (`vitest.config.ts` wires `**/*.test-d.ts`).
import { test } from "vitest";
import type { CommandSpec } from "./command-spec.js";

function baseFields(): Omit<CommandSpec<never>, "env"> {
  return {
    bin: "/usr/bin/true",
    subcommand: ["noop"],
    argsSchema: undefined as never,
    buildArgv: () => ["noop"],
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  };
}

test("an explicit env map is assignable to CommandSpec.env", () => {
  // Positive control: a real, explicit env map IS assignable. Before 0.2
  // adds `env` to `CommandSpec`, this line fails to typecheck ("does not
  // exist in type") — that failure, not the two `@ts-expect-error` cases
  // below (which would trivially "pass" either way, since an unknown
  // property is itself an error regardless of its value), is this file's
  // actual RED before GREEN: a legitimate use of the field must compile
  // once the field exists.
  const withExplicitEnv: CommandSpec<never> = {
    ...baseFields(),
    env: { EXAMPLE_VAR: "value" },
  };
  void withExplicitEnv;
});

test("process.env is not assignable to CommandSpec.env", () => {
  const withProcessEnv: CommandSpec<never> = {
    ...baseFields(),
    // @ts-expect-error — `process.env`'s index signature is
    // `string | undefined`, not assignable to `Readonly<Record<string, string>>`.
    env: process.env,
  };
  void withProcessEnv;
});

test("a spread of process.env is not assignable to CommandSpec.env", () => {
  const withSpreadProcessEnv: CommandSpec<never> = {
    ...baseFields(),
    // @ts-expect-error — spreading `process.env` does not launder the index
    // signature; the result type is still `Record<string, string | undefined>`.
    env: { ...process.env },
  };
  void withSpreadProcessEnv;
});

test("env: undefined is rejected by exactOptionalPropertyTypes — absent has one spelling", () => {
  // @ts-expect-error — `exactOptionalPropertyTypes: true` forbids an
  // explicit `undefined` for an optional property; "absent" means omitting
  // the key entirely, never assigning `undefined` to it. (The diagnostic
  // attaches to this whole-object assignment, not the `env:` line itself —
  // unlike the excess-property checks above.)
  const withUndefinedEnv: CommandSpec<never> = {
    ...baseFields(),
    env: undefined,
  };
  void withUndefinedEnv;
});
