// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 1; tasks.md 1.1) that `classify()`'s
// envelope parameter structurally cannot carry a `status` field an
// implementation could read: passing one on an object literal argument
// trips TypeScript's excess-property check. Combined with `classify.length
// === 2` in `graphql.test.ts` (a runtime arity proof), this shows the
// classifier cannot see the status by TWO independent mechanisms — not
// merely that it happens to ignore a field it could read. Run under
// `vitest --typecheck` (never executed).
import { test } from "vitest";
import { classify } from "./graphql.js";

test("classify()'s envelope parameter rejects an object literal carrying status", () => {
  // @ts-expect-error — `status` is not a key of the envelope type classify()
  // accepts; an object literal carrying it fails TypeScript's excess-property
  // check, proving the classifier's input shape structurally excludes it.
  classify({ data: { ok: true }, status: 200 }, { name: "ListPolicies" });
});

test("classify()'s envelope parameter rejects an object literal carrying ok", () => {
  // @ts-expect-error — same proof for `response.ok`, the other half of the
  // transport-level signal that must never reach GraphQL classification.
  classify({ data: { ok: true }, ok: true }, { name: "ListPolicies" });
});
