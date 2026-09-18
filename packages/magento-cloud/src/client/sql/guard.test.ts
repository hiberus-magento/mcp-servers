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
