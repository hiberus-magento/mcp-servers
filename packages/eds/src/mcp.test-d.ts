// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 7; tasks.md 7.1, 7.7) that:
//   1. `eds_reindex`'s full-site branch is unreachable at the type level
//      without BOTH the literal discriminant `scope: "full-site"` AND the
//      literal `true` on `confirmFullReindex`.
//   2. An empty array literal is rejected at the client-boundary `paths:
//      readonly [string, ...string[]]` parameter.
// Run under `vitest --typecheck` (never executed).
import { test } from "vitest";
import type { z } from "zod";
import { edsReindexInput } from "./tools/eds-tools.js";

type ReindexRequestInput = z.infer<typeof edsReindexInput>["request"];

test("scope: full-site alone is not assignable — confirmFullReindex is required", () => {
  // @ts-expect-error — missing the required literal `confirmFullReindex: true`.
  const request: ReindexRequestInput = { scope: "full-site" };
  void request;
});

test("scope: full-site with confirmFullReindex: false is not assignable", () => {
  const request: ReindexRequestInput = {
    scope: "full-site",
    // @ts-expect-error — `z.literal(true)` infers `true`, not `boolean`.
    confirmFullReindex: false,
  };
  void request;
});

test("scope: full-site with confirmFullReindex: true IS assignable", () => {
  const request: ReindexRequestInput = { scope: "full-site", confirmFullReindex: true };
  void request;
});

test("scope: paths with a non-empty paths array is assignable", () => {
  const request: ReindexRequestInput = { scope: "paths", paths: ["/a"] };
  void request;
});

test("an empty array literal is rejected at the client-boundary paths tuple parameter", async () => {
  const { setLiveState } = await import("./client/operations/live.js");
  const httpStub = { send: async () => new Response(null, { status: 200 }) };
  void setLiveState(httpStub, {
    org: "acme-demo-org",
    site: "acme-demo-site-eu",
    state: "published",
    // @ts-expect-error — `paths` is `readonly [string, ...string[]]`; `[]` has no first element.
    paths: [],
  });
});
