// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 3; tasks.md 5.3) — the FIRST of
// three independent no-`{ mode: "all" }`-branch proofs (runtime `safeParse`
// is the second, `aco-tools.test.ts`; the built-bundle JSON Schema
// `properties.mode.const` check is the third, Phase 6, out of scope here):
// `acoTogglePolicyFilterInput`'s `mode` field is exactly the literal
// `"named"`, and `{ mode: "all", ... }` is not assignable to it at all. Run
// under `vitest --typecheck` (never executed).
//
// CHANGED DELIBERATELY: these assertions named `acoTogglePolicyInput` and
// its `names: string[]`. The tool is `aco_toggle_policy_filter` now and
// addresses one filter in one policy (`tools/aco-tools.ts` records why);
// `mode` and this proof are unchanged.
import { expectTypeOf, test } from "vitest";
import type { z } from "zod";
import { acoTogglePolicyFilterInput } from "./tools/aco-tools.js";

type AcoTogglePolicyFilterInput = z.infer<typeof acoTogglePolicyFilterInput>;

test('mode is exactly the literal "named" — never widened to string', () => {
  expectTypeOf<AcoTogglePolicyFilterInput["mode"]>().toEqualTypeOf<"named">();
});

test('{ mode: "all", ... } is not assignable — there is no all branch', () => {
  // @ts-expect-error — "all" is not a member of the closed literal union (it has exactly one member).
  const input: AcoTogglePolicyFilterInput = { mode: "all", policyName: "outdoor-gear-discount", attribute: "price_band", enabled: true };
  void input;
});

test('the valid { mode: "named", ... } shape IS assignable', () => {
  const input: AcoTogglePolicyFilterInput = { mode: "named", policyName: "outdoor-gear-discount", attribute: "price_band", enabled: true };
  void input;
});
