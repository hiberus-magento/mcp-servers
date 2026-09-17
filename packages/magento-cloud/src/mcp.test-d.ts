// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 2 of the magento-cloud-mcp spec;
// tasks.md 8.3): `magentocloud_query_database`'s `request` argument is a
// discriminated union of `{ kind: "size" }` and
// `{ kind: "select", query, maxRows? }` — no boolean `includeSize` flag and
// no free-form `mode` string anywhere in the schema. Run under
// `vitest --typecheck` (never executed).
import { expectTypeOf, test } from "vitest";
import type { z } from "zod";
import { magentocloudQueryDatabaseInput } from "./tools/magento-cloud-tools.js";

type QueryDatabaseInput = z.infer<typeof magentocloudQueryDatabaseInput>;

test("the request discriminant is exactly \"size\" | \"select\" — never a free-form mode string", () => {
  expectTypeOf<QueryDatabaseInput["request"]["kind"]>().toEqualTypeOf<"size" | "select">();
});

test("a free-form mode string call site fails to compile", () => {
  // @ts-expect-error — there is no `mode` field; the discriminant is `kind`, a closed union, never a free-form string.
  const input: QueryDatabaseInput = { projectId: "p", environmentId: "e", request: { mode: "select", query: "SELECT 1" } };
  void input;
});

test("an omitted query on the select branch fails to compile", () => {
  // @ts-expect-error — `query` is required on the "select" branch; there is no schema path that constructs a select request without it.
  const input: QueryDatabaseInput = { projectId: "p", environmentId: "e", request: { kind: "select" } };
  void input;
});

test("a boolean includeSize flag does not exist anywhere on the input", () => {
  // @ts-expect-error — there is no includeSize field; "size" is a request kind, never a boolean flag alongside a query.
  const input: QueryDatabaseInput = { projectId: "p", environmentId: "e", request: { kind: "select", query: "SELECT 1", includeSize: true } };
  void input;
});

test("the valid { kind: \"size\" } shape is assignable, with no query field", () => {
  const input: QueryDatabaseInput = { projectId: "p", environmentId: "e", request: { kind: "size" } };
  void input;
});

test("the valid { kind: \"select\", query } shape is assignable", () => {
  const input: QueryDatabaseInput = { projectId: "p", environmentId: "e", request: { kind: "select", query: "SELECT 1" } };
  void input;
});
