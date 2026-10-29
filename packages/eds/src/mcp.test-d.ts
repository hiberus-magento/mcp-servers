// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 7; tasks.md 7.1, 7.7) that:
//   1. the full-site reindex is unreachable at the type level without BOTH
//      the literal discriminant AND the literal `true` on
//      `confirmFullReindex`. CHANGED DELIBERATELY (eds-write-surface 4.1):
//      the gate moved from `eds_reindex`'s `request` to `eds_plan`'s
//      `operation`, with `kind: "index.full-site"` as the discriminant.
//   2. An empty array literal is rejected at the client-boundary `paths:
//      readonly [string, ...string[]]` parameter.
// Run under `vitest --typecheck` (never executed).
import { test } from "vitest";
import type { z } from "zod";
import { edsPlanInput } from "./tools/plan.js";

type PlanOperationInput = z.infer<typeof edsPlanInput>["operation"];

test("kind: index.full-site alone is not assignable — confirmFullReindex is required", () => {
  // @ts-expect-error — missing the required literal `confirmFullReindex: true`.
  const operation: PlanOperationInput = { kind: "index.full-site" };
  void operation;
});

test("kind: index.full-site with confirmFullReindex: false is not assignable", () => {
  const operation: PlanOperationInput = {
    kind: "index.full-site",
    // @ts-expect-error — `z.literal(true)` infers `true`, not `boolean`.
    confirmFullReindex: false,
  };
  void operation;
});

test("kind: index.full-site with confirmFullReindex: true IS assignable", () => {
  const operation: PlanOperationInput = { kind: "index.full-site", confirmFullReindex: true };
  void operation;
});

test("kind: index.update with a non-empty paths array is assignable", () => {
  const operation: PlanOperationInput = { kind: "index.update", paths: ["/a"] };
  void operation;
});

test("an empty array literal is rejected at the client-boundary paths tuple parameter", async () => {
  const { setLiveState } = await import("./client/operations/live.js");
  // CHANGED DELIBERATELY: `HttpClient` gained `readJson`/`readOptionalJson`
  // and later `readText`, so this stub has to satisfy them too. The
  // assertion under test — that `paths: []` is rejected — is untouched.
  const httpStub = {
    send: async () => new Response(null, { status: 200 }),
    readJson: async () => ({}) as never,
    readOptionalJson: async () => ({ status: 200, hasContent: false }) as never,
    readText: async () => "",
  };
  void setLiveState(httpStub, {
    org: "acme-demo-org",
    site: "acme-demo-site-eu",
    state: "published",
    // @ts-expect-error — `paths` is `readonly [string, ...string[]]`; `[]` has no first element.
    paths: [],
  });
});
