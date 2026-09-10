// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 1; tasks.md 1.5) that
// `RetryableAcoError = AcoThrottledError | AcoTransportError` genuinely
// excludes `AdminScopeError | CatalogViewAccessError | AcoOperationError |
// AcoSchemaMismatchError`. Retrying any of the four is a `tsc` error here,
// not a judgement call. Run under `vitest --typecheck` (never executed).
import { test } from "vitest";
import { AcoOperationError, AcoSchemaMismatchError, AdminScopeError, CatalogViewAccessError } from "./errors.js";
import type { RetryableAcoError } from "./errors.js";

test("AdminScopeError is not assignable to RetryableAcoError", () => {
  // @ts-expect-error — a live scope failure must never be replayed.
  const value: RetryableAcoError = new AdminScopeError({ operationName: "ListChannels" });
  void value;
});

test("CatalogViewAccessError is not assignable to RetryableAcoError", () => {
  // @ts-expect-error — an access-key failure must never be replayed.
  const value: RetryableAcoError = new CatalogViewAccessError({ operationName: "SearchCatalog" });
  void value;
});

test("AcoOperationError is not assignable to RetryableAcoError", () => {
  // @ts-expect-error — an operation-level failure is not transient by definition.
  const value: RetryableAcoError = new AcoOperationError({ operationName: "ListPolicies", hadPartialData: false });
  void value;
});

test("AcoSchemaMismatchError is not assignable to RetryableAcoError", () => {
  // @ts-expect-error — a stale-schema failure will not resolve itself on retry.
  const value: RetryableAcoError = new AcoSchemaMismatchError({ operationName: "ListChannels", fieldPath: "channels[].channelId" });
  void value;
});
