// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 5.1): the lexer strips '…'/"…"/`…` literals (with
// \' and '' escapes), -- / # line comments, and /*…*/ block comments, and
// tracks paren depth so the depth-0 `;` split and the depth-0 trailing
// `LIMIT` scan (guard.ts, Rule 1 and Rule 4) both read the SAME stripped
// form — a single source of truth, per design.md Decision 5.
import { describe, expect, it } from "vitest";
import { lex } from "./lex.js";

describe("lex — literal stripping (one fixture per case, exact stripped form)", () => {
  it("strips a single-quoted literal to an empty placeholder", () => {
    expect(lex("SELECT 'acme-demo-sku' FROM t").stripped).toBe("SELECT '' FROM t");
  });

  it("strips a single-quoted literal containing a backslash-escaped quote", () => {
    expect(lex("SELECT 'it\\'s' FROM t").stripped).toBe("SELECT '' FROM t");
  });

  it("strips a single-quoted literal containing a doubled-quote escape", () => {
    expect(lex("SELECT 'it''s' FROM t").stripped).toBe("SELECT '' FROM t");
  });

  it("strips a double-quoted literal to an empty placeholder", () => {
    expect(lex('SELECT "value" FROM t').stripped).toBe('SELECT "" FROM t');
  });

  it("strips a backtick-quoted identifier to an empty placeholder", () => {
    expect(lex("SELECT `col` FROM t").stripped).toBe("SELECT `` FROM t");
  });

  it("strips a -- line comment through end of line, keeping the next line", () => {
    expect(lex("SELECT 1 -- comment\nFROM t").stripped).toBe("SELECT 1 \nFROM t");
  });

  it("strips a # line comment through end of line", () => {
    expect(lex("SELECT 1 # comment\nFROM t").stripped).toBe("SELECT 1 \nFROM t");
  });

  it("strips a /* ... */ block comment, including one spanning a newline", () => {
    expect(lex("SELECT/*block\ncomment*/1 FROM t").stripped).toBe("SELECT1 FROM t");
  });

  it("a `*` inside a string literal is neutralized, never a projection star", () => {
    // The residual this proves inert (design.md, Decision 5): the literal's
    // CONTENT is gone, so `*` never reaches guard.ts's Rule 2 scan.
    const stripped = lex("SELECT id FROM t WHERE name = '*'").stripped;
    expect(stripped).not.toContain("*");
    expect(stripped).toBe("SELECT id FROM t WHERE name = ''");
  });
});

describe("lex — depth-0 statement splitting", () => {
  it("splits two `;`-separated top-level statements into two entries", () => {
    expect(lex("SELECT 1; SELECT 2").statements).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("a single trailing `;` still yields exactly one statement", () => {
    expect(lex("SELECT 1;").statements).toEqual(["SELECT 1"]);
  });

  it("does NOT split on a `;` inside a string literal — the naive control is shown wrong first", () => {
    const query = "SELECT 'a;b' FROM t";

    // Naive control: splitting the RAW text on every `;` is the wrong
    // approach — it produces two pieces even though this is one statement.
    expect(query.split(";")).toHaveLength(2);

    // The real lexer, having stripped the literal's content first, sees no
    // `;` at all and correctly reports one statement.
    expect(lex(query).statements).toHaveLength(1);
  });

  it("does NOT split on a `;` inside parentheses (depth > 0)", () => {
    // A `;` at depth 1 must never be mistaken for a top-level statement
    // separator — this is the same depth tracking Rule 4 reuses for LIMIT.
    expect(lex("SELECT (1;2) FROM t").statements).toHaveLength(1);
  });
});

describe("lex — paren depth tracking", () => {
  it("reports depth 0 outside any parens and depth 1 immediately inside", () => {
    const { stripped, depths } = lex("A(B)C");
    // A ( B ) C
    // 0 0 1 0 0   <- depth AT each character index
    expect(depths[stripped.indexOf("A")]).toBe(0);
    expect(depths[stripped.indexOf("(")]).toBe(0);
    expect(depths[stripped.indexOf("B")]).toBe(1);
    expect(depths[stripped.indexOf(")")]).toBe(0);
    expect(depths[stripped.indexOf("C")]).toBe(0);
  });
});
