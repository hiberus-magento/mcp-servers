// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 2; tasks.md 1.9) that
// `MerchandisingTransportDeps` has NO `tokenProvider` field at all — a
// Merchandising operation cannot accidentally acquire an admin credential
// because there is nothing on this type to read it from — and that an
// admin-track `GraphQlOperation<"admin", T>` is not assignable to
// `MerchandisingTransport.execute`. Both are `tsc` errors, not judgement
// calls. Run under `vitest --typecheck` (never executed).
import { test } from "vitest";
import type { GraphQlOperation, MerchandisingTransport, MerchandisingTransportDeps } from "./http.js";

declare const merchandisingDeps: MerchandisingTransportDeps;

test("MerchandisingTransportDeps has no tokenProvider field to read", () => {
  // @ts-expect-error — `tokenProvider` is not a key of MerchandisingTransportDeps:
  // there is nothing here from which a Merchandising call could acquire an admin Bearer.
  void merchandisingDeps.tokenProvider;
});

declare const merchandisingTransport: MerchandisingTransport;
declare const adminOperation: GraphQlOperation<"admin", { readonly catalogViews: readonly unknown[] }>;
declare const merchContext: { readonly viewId: string; readonly locale: string };

test("an admin GraphQlOperation is not assignable to MerchandisingTransport.execute", () => {
  // @ts-expect-error — GraphQlOperation<"admin", T> is not GraphQlOperation<"merchandising", T>:
  // routing an admin query over the merchandising transport is a compile error.
  void merchandisingTransport.execute(adminOperation, merchContext);
});
