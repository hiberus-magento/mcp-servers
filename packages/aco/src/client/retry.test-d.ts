// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 4; tasks.md 1.16) that
// `AdminScopeError` is rejected by `RetryOutcome.error`'s type. Retrying a
// live scope failure is the wrong remedy (it will not resolve itself on
// replay) — this makes it a compile error, not a judgement call. Mirrors
// `packages/eds/src/client/retry.test-d.ts` (read-only). Run under
// `vitest --typecheck` (never executed).
import { test } from "vitest";
import { AdminScopeError } from "./errors.js";
import type { RetryOutcome } from "./retry.js";

test("AdminScopeError is not assignable to RetryOutcome.error", () => {
  const outcome: RetryOutcome = {
    // @ts-expect-error — AdminScopeError is deliberately excluded from the
    // retryable union (AcoThrottledError | AcoTransportError).
    error: new AdminScopeError({ operationName: "ListCatalogViews" }),
    idempotent: true,
  };
  void outcome;
});
