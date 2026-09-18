// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 5.3-5.14). Every rejection case additionally proves
// what it claims: `guardQuery` returns `{ ok: false }` and never produces a
// `GuardedQuery`. The `execFile`-never-called half of this guarantee is
// proven separately, at the `CommandSpec` boundary, in
// `../commands.test.ts` (tasks.md 5.4-5.5, 5.15) — this file proves the
// pure decision function in isolation.
import { describe, expect, it } from "vitest";
import { guardQuery } from "./guard.js";

const ROW_CAP = 200;

describe("guardQuery — Rule 1: single statement, read-only leading verb", () => {
  it("accepts a single SELECT ... LIMIT statement", () => {
    const result = guardQuery("SELECT id FROM catalog_product_entity WHERE sku = 'acme-demo-sku' LIMIT 10", {
      rowCap: ROW_CAP,
    });

    expect(result.ok).toBe(true);
  });

  it.each(["UPDATE t SET a = 1", "DELETE FROM t", "INSERT INTO t VALUES (1)", "DROP TABLE t"])(
    "rejects a mutating leading verb: %s",
    (query) => {
      const result = guardQuery(query, { rowCap: ROW_CAP });

      expect(result.ok).toBe(false);
    },
  );

  it("rejects a second statement after a semicolon, even when the first is a valid SELECT", () => {
    const result = guardQuery("SELECT 1 FROM t; DROP TABLE t", { rowCap: ROW_CAP });

    expect(result.ok).toBe(false);
  });
});

describe("guardQuery — Rule 2: no `*` outside COUNT(*)", () => {
  it("rejects SELECT *", () => {
    expect(guardQuery("SELECT * FROM catalog_product_entity", { rowCap: ROW_CAP }).ok).toBe(false);
  });

  it("rejects SELECT DISTINCT *", () => {
    expect(guardQuery("SELECT DISTINCT * FROM catalog_product_entity", { rowCap: ROW_CAP }).ok).toBe(false);
  });

  it("rejects a qualified t.* — proves this is not a projection-clause regex", () => {
    expect(guardQuery("SELECT t.* FROM catalog_product_entity t", { rowCap: ROW_CAP }).ok).toBe(false);
  });

  it("rejects SeLeCt * — case-insensitive evasion", () => {
    expect(guardQuery("SeLeCt * FROM t", { rowCap: ROW_CAP }).ok).toBe(false);
  });

  it("rejects /*c*/SELECT * — comment-interleaved evasion", () => {
    expect(guardQuery("/*c*/SELECT * FROM t", { rowCap: ROW_CAP }).ok).toBe(false);
  });

  it("rejects a `*` hidden inside a subquery, regardless of depth", () => {
    const result = guardQuery("SELECT id FROM (SELECT t.* FROM big t) x", { rowCap: ROW_CAP });

    expect(result.ok).toBe(false);
  });

  it("ACCEPTED COST, recorded as a decision: rejects arithmetic SELECT a * b, naming both exits", () => {
    const result = guardQuery("SELECT a * b FROM t", { rowCap: ROW_CAP });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/columns/i);
      expect(result.message).toMatch(/COUNT\(\*\)/);
    }
  });

  it("accepts SELECT COUNT(*) FROM t — the sole permitted `*` form", () => {
    expect(guardQuery("SELECT COUNT(*) FROM t", { rowCap: ROW_CAP }).ok).toBe(true);
  });

  it("a `*` inside a string literal is allowed — a value, never a projection", () => {
    expect(guardQuery("SELECT id FROM t WHERE name = '*'", { rowCap: ROW_CAP }).ok).toBe(true);
  });
});

describe("guardQuery — Rule 3: file-exfiltration forms", () => {
  it("rejects INTO OUTFILE", () => {
    expect(guardQuery("SELECT * FROM t INTO OUTFILE '/tmp/x'", { rowCap: ROW_CAP }).ok).toBe(false);
    expect(guardQuery("SELECT id FROM t INTO OUTFILE '/tmp/x'", { rowCap: ROW_CAP }).ok).toBe(false);
  });

  it("rejects INTO DUMPFILE", () => {
    expect(guardQuery("SELECT id FROM t INTO DUMPFILE '/tmp/x'", { rowCap: ROW_CAP }).ok).toBe(false);
  });

  it("rejects LOAD_FILE(", () => {
    expect(guardQuery("SELECT LOAD_FILE('/etc/passwd')", { rowCap: ROW_CAP }).ok).toBe(false);
  });
});

describe("guardQuery — Rule 4: mandatory LIMIT + row-cap enforcement", () => {
  it("injects LIMIT <rowCap> when absent, into the returned query text", () => {
    const result = guardQuery("SELECT id FROM t", { rowCap: ROW_CAP });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).toContain(`LIMIT ${ROW_CAP}`);
    }
  });

  it("rejects — never clamps — an explicit LIMIT above the cap, naming the cap", () => {
    const result = guardQuery("SELECT id FROM t LIMIT 999999", { rowCap: ROW_CAP });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(String(ROW_CAP));
    }
  });

  it("accepts an explicit LIMIT at or below the cap, unchanged", () => {
    const result = guardQuery("SELECT id FROM t LIMIT 10", { rowCap: ROW_CAP });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).toBe("SELECT id FROM t LIMIT 10");
    }
  });

  it("a subquery's own LIMIT is not mistaken for the statement's — the outer statement still gets one injected", () => {
    const result = guardQuery("SELECT id FROM (SELECT id FROM t LIMIT 5) x", { rowCap: ROW_CAP });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The outer statement carried no depth-0 LIMIT of its own, so one is
      // injected — proving the depth-1 LIMIT inside the subquery was not
      // read as the statement's own trailing LIMIT.
      expect(result.query).toContain(`LIMIT ${ROW_CAP}`);
    }
  });

  it.each(["SHOW TABLES", "DESCRIBE t", "EXPLAIN SELECT id FROM t"])(
    "takes no injected LIMIT for a non-SELECT read-only verb: %s",
    (query) => {
      const result = guardQuery(query, { rowCap: ROW_CAP });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.query).toBe(query);
      }
    },
  );
});

describe("guardQuery — comments are rejected, never stripped", () => {
  // Every rule in `guardQuery` reads `lexed.stripped`, but the value it
  // brands and sends is the RAW query. MySQL and MariaDB EXECUTE version
  // comments (`/*!NNNNN … */`) as real SQL, so anything placed inside one
  // was analysed as if absent and executed anyway. Proven against a live
  // production database: `SELECT 1 /*!50000 , 2 */` returned two columns.
  //
  // A comment therefore cannot be neutralised by stripping. It has to be a
  // rejection.
  it("rejects the version comment that bypassed every other rule", () => {
    expect(guardQuery("SELECT 1 /*!50000 , 2 */", { rowCap: ROW_CAP }).ok).toBe(false);
  });

  it("rejects a version comment smuggling a write verb", () => {
    expect(guardQuery("/*!50000 DROP TABLE t */ SELECT 1", { rowCap: ROW_CAP }).ok).toBe(false);
  });

  it.each([
    ["plain block comment", "SELECT/*x*/1 FROM t"],
    ["trailing -- comment", "SELECT 1 FROM t -- note"],
    ["# comment", "SELECT 1 FROM t # note"],
  ])("rejects a %s", (_label, query) => {
    expect(guardQuery(query, { rowCap: ROW_CAP }).ok).toBe(false);
  });

  // POSITIVE CONTROL: the rejection must key off a real comment, not off
  // the characters appearing anywhere. A comment introducer inside a string
  // literal is data, and rejecting it would break legitimate queries — so
  // this proves the rule reads the lexer rather than scanning raw text.
  it("positive control: comment characters inside a string literal are data, not a comment", () => {
    const result = guardQuery("SELECT id FROM t WHERE note = '-- not a comment' LIMIT 10", { rowCap: ROW_CAP });

    expect(result.ok).toBe(true);
  });

  it("positive control: a block-comment opener inside a literal is still data", () => {
    expect(guardQuery("SELECT id FROM t WHERE note = '/*' LIMIT 10", { rowCap: ROW_CAP }).ok).toBe(true);
  });

  // POSITIVE CONTROL: an ordinary query must still pass, or the rule has
  // simply broken the tool rather than secured it.
  it("positive control: a comment-free query is still accepted", () => {
    expect(guardQuery("SELECT id FROM t LIMIT 10", { rowCap: ROW_CAP }).ok).toBe(true);
  });
});

// A CTE-based diagnostic query is an ordinary read, and refusing it pushed
// operators towards flattening real questions into shapes the guard happened
// to like. `WITH` is therefore a read-only leading verb — but it is the ONLY
// one whose statement kind is not decided by its first word, so these tests
// exist to prove that everything a plain SELECT is subjected to still
// applies, and that the statement the CTE list actually leads to is checked
// rather than assumed.
describe("guardQuery — WITH (common table expressions)", () => {
  it("accepts a WITH ... SELECT carrying its own LIMIT, unchanged", () => {
    const query = "WITH recent AS (SELECT id FROM sales_order WHERE status = 'processing') SELECT id FROM recent LIMIT 10";

    const result = guardQuery(query, { rowCap: ROW_CAP });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).toBe(query);
    }
  });

  it("accepts a multi-CTE list and a CTE column list", () => {
    const query =
      "WITH a (id) AS (SELECT id FROM t), b AS (SELECT id FROM u) SELECT a.id FROM a JOIN b ON a.id = b.id LIMIT 5";

    expect(guardQuery(query, { rowCap: ROW_CAP }).ok).toBe(true);
  });

  it("accepts WITH RECURSIVE", () => {
    const query = "WITH RECURSIVE nums AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM nums WHERE n < 5) SELECT n FROM nums LIMIT 5";

    expect(guardQuery(query, { rowCap: ROW_CAP }).ok).toBe(true);
  });

  // THE test for this change. `WITH` is a non-SELECT leading verb, and the
  // pre-existing `verb !== "SELECT"` early return skipped LIMIT handling
  // entirely for every one of those — correct for SHOW/DESCRIBE/EXPLAIN,
  // catastrophic for a `WITH ... SELECT`, which returns rows exactly like a
  // plain SELECT and would have run unbounded against a production database.
  it("injects LIMIT <rowCap> into a WITH ... SELECT that carries none", () => {
    const query = "WITH recent AS (SELECT id FROM sales_order) SELECT id FROM recent";
    // The probe is only meaningful if the input genuinely lacks a LIMIT.
    expect(query).not.toMatch(/LIMIT/i);

    const result = guardQuery(query, { rowCap: ROW_CAP });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).toBe(`${query} LIMIT ${ROW_CAP}`);
    }
  });

  it("a CTE's own LIMIT is not mistaken for the statement's — the outer statement still gets one injected", () => {
    const result = guardQuery("WITH recent AS (SELECT id FROM t LIMIT 5) SELECT id FROM recent", { rowCap: ROW_CAP });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).toContain(`LIMIT ${ROW_CAP}`);
    }
  });

  it("rejects — never clamps — a WITH ... SELECT whose own LIMIT exceeds the cap", () => {
    const result = guardQuery("WITH recent AS (SELECT id FROM t) SELECT id FROM recent LIMIT 999999", {
      rowCap: ROW_CAP,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(String(ROW_CAP));
    }
  });

  // POSITIVE CONTROL for Rule 2 under the new verb: the bare-`*` ban is not
  // bypassed by wrapping the query in a CTE.
  it("positive control: a bare `*` in the outer SELECT of a WITH is still rejected", () => {
    const result = guardQuery("WITH recent AS (SELECT id FROM t) SELECT * FROM recent", { rowCap: ROW_CAP });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/COUNT\(\*\)/);
    }
  });

  it("positive control: a bare `*` INSIDE the CTE body is still rejected", () => {
    expect(guardQuery("WITH recent AS (SELECT t.* FROM t) SELECT id FROM recent", { rowCap: ROW_CAP }).ok).toBe(false);
  });

  it("positive control: COUNT(*) is still the sole permitted `*` form inside a CTE", () => {
    expect(guardQuery("WITH c AS (SELECT COUNT(*) AS n FROM t) SELECT n FROM c LIMIT 1", { rowCap: ROW_CAP }).ok).toBe(
      true,
    );
  });

  it("positive control: an exfiltration form is still rejected under a WITH", () => {
    const result = guardQuery("WITH recent AS (SELECT id FROM t) SELECT id FROM recent INTO OUTFILE '/tmp/x'", {
      rowCap: ROW_CAP,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("INTO OUTFILE");
    }
  });

  it("positive control: a comment is still rejected under a WITH, never stripped", () => {
    expect(guardQuery("WITH recent AS (SELECT 1 /*!50000 , 2 */) SELECT 1 FROM recent", { rowCap: ROW_CAP }).ok).toBe(
      false,
    );
  });

  // MySQL 8.0 permits `WITH ... UPDATE` and `WITH ... DELETE` (Reference
  // Manual, "WITH (Common Table Expressions)"): the statement a CTE list
  // leads to is NOT constrained by the `WITH` keyword. Accepting `WITH` on
  // its leading word alone would therefore have accepted a delete.
  //
  // Each of these asserts the rejection came from the CTE rule and names the
  // verb it actually found — NOT from the blanket "WITH is not a read-only
  // leading verb" refusal, which would make these tests pass without the
  // rule they exist to prove ever running.
  it.each([
    ["DELETE", "WITH recent AS (SELECT id FROM t) DELETE FROM t WHERE id IN (SELECT id FROM recent)"],
    ["UPDATE", "WITH recent AS (SELECT id FROM t) UPDATE t SET status = 'x' WHERE id IN (SELECT id FROM recent)"],
    ["INSERT", "WITH recent AS (SELECT id FROM t) INSERT INTO u (id) SELECT id FROM recent"],
    ["REPLACE", "WITH recent AS (SELECT id FROM t) REPLACE INTO u (id) SELECT id FROM recent"],
  ])("rejects a WITH clause leading to a %s statement", (verb, query) => {
    const result = guardQuery(query, { rowCap: ROW_CAP });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(verb);
      expect(result.message).not.toContain("must begin with one of");
    }
  });

  // Fail-closed beyond MySQL: a data-modifying CTE body is a PostgreSQL
  // feature, not a MySQL/MariaDB one — but the guard is not the right place
  // to bet on which engine is on the other end of `db:sql`.
  it("rejects a data-modifying CTE body, whatever the outer statement is", () => {
    const result = guardQuery("WITH gone AS (DELETE FROM t RETURNING id) SELECT id FROM gone", { rowCap: ROW_CAP });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("DELETE");
      expect(result.message).not.toContain("must begin with one of");
    }
  });

  it.each([
    ["no AS keyword", "WITH recent (SELECT id FROM t) SELECT id FROM recent"],
    ["no CTE body parentheses", "WITH recent AS SELECT id FROM t SELECT id FROM recent"],
    ["no CTE name", "WITH AS (SELECT id FROM t) SELECT id FROM recent"],
    ["nothing after the CTE list", "WITH recent AS (SELECT id FROM t)"],
    ["a nested WITH as the CTE body", "WITH outer_cte AS (WITH inner_cte AS (SELECT id FROM t) SELECT id FROM inner_cte) SELECT id FROM outer_cte"],
    // MariaDB allows a `CYCLE … RESTRICT` clause between the CTE list and
    // the statement verb, so the token after the last `)` is not always the
    // verb. Rejecting is the fail-closed answer, and an accepted cost.
    ["MariaDB's CYCLE clause", "WITH RECURSIVE c AS (SELECT id, parent FROM t) CYCLE id RESTRICT SELECT id FROM c"],
    // MySQL allows `TABLE t` after a CTE list. It is read-only, but it is
    // not a SELECT, and the guard's LIMIT handling has nothing to say about
    // it — so it is refused rather than special-cased.
    ["a TABLE statement after the CTE list", "WITH c AS (SELECT id FROM t) TABLE t"],
  ])("rejects a WITH clause it cannot parse: %s", (_label, query) => {
    const result = guardQuery(query, { rowCap: ROW_CAP });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("must begin with one of");
    }
  });

  // `INSERT … WITH … SELECT` (the WITH clause AFTER the verb) is the legal
  // MySQL/MariaDB form for a CTE-fed insert, and it is still a write. It is
  // caught by the leading-verb rule, not by the CTE rule — this pins that
  // the two together leave no gap.
  it.each([
    ["INSERT", "INSERT INTO u (id) WITH c AS (SELECT id FROM t) SELECT id FROM c"],
    ["REPLACE", "REPLACE INTO u (id) WITH c AS (SELECT id FROM t) SELECT id FROM c"],
    ["CREATE TABLE", "CREATE TABLE u AS WITH c AS (SELECT id FROM t) SELECT id FROM c"],
  ])("rejects a %s whose WITH clause comes after the verb", (_label, query) => {
    expect(guardQuery(query, { rowCap: ROW_CAP }).ok).toBe(false);
  });

  // `USE` mutates session state (it changes the default schema for every
  // subsequent statement on the connection), so it is deliberately NOT a
  // read-only leading verb even though it reads nothing itself.
  it("still rejects USE — adding WITH did not widen the verb set further", () => {
    expect(guardQuery("USE information_schema", { rowCap: ROW_CAP }).ok).toBe(false);
  });
});
