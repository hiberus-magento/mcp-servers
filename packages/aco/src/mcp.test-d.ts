// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 3; tasks.md 5.3) — the FIRST of
// three independent no-`{ mode: "all" }`-branch proofs (runtime `safeParse`
// is the second, `aco-tools.test.ts`; the built-bundle JSON Schema
// `properties.mode.enum` check is the third, Phase 6, out of scope here):
// `acoTogglePolicyInput`'s `mode` field is exactly the literal `"named"`,
// and `{ mode: "all", ... }` is not assignable to it at all. Run under
// `vitest --typecheck` (never executed).
import { expectTypeOf, test } from "vitest";
import type { z } from "zod";
import { acoTogglePolicyInput } from "./tools/aco-tools.js";

type AcoTogglePolicyInput = z.infer<typeof acoTogglePolicyInput>;

test("mode is exactly the literal \"named\" — never widened to string", () => {
  expectTypeOf<AcoTogglePolicyInput["mode"]>().toEqualTypeOf<"named">();
});

test("{ mode: \"all\", ... } is not assignable — there is no all branch", () => {
  // @ts-expect-error — "all" is not a member of the closed literal union (it has exactly one member).
  const input: AcoTogglePolicyInput = { mode: "all", names: ["outdoor-gear-discount"], enabled: true };
  void input;
});

test("the valid { mode: \"named\", ... } shape IS assignable", () => {
  const input: AcoTogglePolicyInput = { mode: "named", names: ["outdoor-gear-discount"], enabled: true };
  void input;
});
