// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `scrollId` pagination, confined to `priceBooks` by shape (design.md,
// Decision 4). Only a result type carrying `items` — and, once Phase 2
// exists, only `ListPriceBooksResult` — is assignable to `ScrollPage<T>`.
// No other result type carries `scrollId`, and no other operation's
// variables type accepts one, so "paginate the policies query" is a `tsc`
// error, not a runtime surprise (`cursor.test.ts`).
export interface ScrollPage<T> {
  readonly items: readonly T[];
  readonly scrollId?: string;
}
