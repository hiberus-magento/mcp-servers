// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The guard is the only thing standing between an agent's free-form SQL and the database, so it is
// tested as a list of statements that MUST be refused and a list that MUST pass, plus the limit rewriting.
import { describe, expect, it } from "vitest";
import { SqlGuardError, guardReadQuery, guardWriteStatement } from "./sql-guard.js";

const refused = (sql: string, max = 100): string => {
  try {
    guardReadQuery(sql, max);
  } catch (error) {
    if (error instanceof SqlGuardError) return error.message;
    throw error;
  }
  throw new Error(`expected a refusal: ${sql}`);
};

describe("guardReadQuery: what passes", () => {
  it.each([
    "SELECT entity_id, sku FROM catalog_product_entity WHERE sku = ?",
    "select count(*) as n from sales_order",
    "SELECT COUNT(*) FROM `customer_entity`",
    "SELECT e.sku, s.qty FROM catalog_product_entity e LEFT JOIN cataloginventory_stock_item s ON s.product_id = e.entity_id WHERE e.created_at > '2024-01-01'",
    "SELECT sku FROM catalog_product_entity WHERE sku IN (SELECT sku FROM catalog_product_entity LIMIT 5) ORDER BY sku",
    "SELECT a.x * 2 AS double FROM t a",
    "SELECT sku FROM catalog_product_entity;",
    "SELECT 'a;b -- c # d /* e */' AS text_with_symbols",
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
  ])("accepts %s", (sql) => {
    expect(() => guardReadQuery(sql, 100)).not.toThrow();
  });

  it("accepts REPLACE() and INSERT() as string functions, in a read and in a write", () => {
    expect(() => guardReadQuery("SELECT REPLACE(sku, '-', '_') AS slug, INSERT(sku, 1, 0, 'x') AS other FROM catalog_product_entity", 100)).not.toThrow();
    expect(() => guardWriteStatement("UPDATE cms_block SET title = REPLACE(title, 'a', 'b') WHERE block_id = 1")).not.toThrow();
  });

  it("is not fooled by a word that merely contains a forbidden one", () => {
    expect(() => guardReadQuery("SELECT updated_at, created_at, attribute_set_id, into_stock FROM t", 100)).not.toThrow();
  });
});

describe("guardReadQuery: what is refused", () => {
  it.each([
    ["a second statement", "SELECT 1; DROP TABLE x"],
    ["a second statement after a literal", "SELECT 'a'; SELECT 2"],
    ["a line comment", "SELECT 1 -- hi"],
    ["a hash comment", "SELECT 1 # hi"],
    ["a block comment", "SELECT /* hi */ 1"],
    ["an executable comment", "SELECT /*!50000 sleep(5) */ 1"],
    ["a statement that is not a SELECT", "DELETE FROM sales_order WHERE 1=1"],
    ["an UPDATE", "UPDATE sales_order SET status = 'x' WHERE 1=1"],
    ["SHOW", "SHOW TABLES"],
    ["a bare star", "SELECT * FROM sales_order"],
    ["a qualified star", "SELECT o.* FROM sales_order o"],
    ["a star after a comma", "SELECT sku, * FROM catalog_product_entity"],
    ["INTO OUTFILE", "SELECT sku FROM catalog_product_entity INTO OUTFILE '/tmp/x'"],
    ["INTO a variable", "SELECT sku INTO @a FROM catalog_product_entity"],
    ["FOR UPDATE", "SELECT sku FROM catalog_product_entity FOR UPDATE"],
    ["LOCK IN SHARE MODE", "SELECT sku FROM catalog_product_entity LOCK IN SHARE MODE"],
    ["SLEEP", "SELECT SLEEP(10)"],
    ["BENCHMARK", "SELECT BENCHMARK(1000000, MD5('a'))"],
    ["LOAD_FILE", "SELECT LOAD_FILE('/etc/passwd')"],
    ["GET_LOCK", "SELECT GET_LOCK('a', 10)"],
    ["a user variable assignment", "SELECT @a := 1"],
    ["PROCEDURE", "SELECT sku FROM t PROCEDURE ANALYSE()"],
    ["the administrators table", "SELECT username FROM admin_user"],
    ["the same table, backticked and qualified", "SELECT username FROM `magento`.`admin_user`"],
    ["an OAuth token table", "SELECT token FROM oauth_token"],
    ["the mysql schema", "SELECT user FROM mysql.user"],
    ["an empty statement", "   "],
    ["an unterminated string", "SELECT 'abc FROM t"],
    ["a control character", "SELECT 1\u0000"],
  ])("refuses %s", (_name, sql) => {
    expect(refused(sql).length).toBeGreaterThan(0);
  });

  it("names the reason", () => {
    expect(refused("SELECT 1; SELECT 2")).toMatch(/one statement/i);
    expect(refused("SELECT * FROM t")).toMatch(/column/i);
    expect(refused("SELECT username FROM admin_user")).toMatch(/admin_user/);
  });
});

describe("guardReadQuery: the row limit", () => {
  it("appends a LIMIT when there is none, and drops the trailing semicolon", () => {
    expect(guardReadQuery("SELECT sku FROM t;", 50).sql).toBe("SELECT sku FROM t LIMIT 50");
  });
  it("keeps a LIMIT within the cap, in either form", () => {
    expect(guardReadQuery("SELECT sku FROM t LIMIT 10", 50).sql).toBe("SELECT sku FROM t LIMIT 10");
    expect(guardReadQuery("SELECT sku FROM t LIMIT 5, 10", 50).sql).toBe("SELECT sku FROM t LIMIT 5, 10");
    expect(guardReadQuery("SELECT sku FROM t LIMIT 10 OFFSET 5", 50).sql).toBe("SELECT sku FROM t LIMIT 10 OFFSET 5");
  });
  it("refuses a LIMIT over the cap, or one it cannot read", () => {
    expect(refused("SELECT sku FROM t LIMIT 5000", 50)).toMatch(/50/);
    expect(refused("SELECT sku FROM t LIMIT 5, 5000", 50)).toMatch(/50/);
    expect(refused("SELECT sku FROM t LIMIT ?", 50)).toMatch(/literal/i);
  });
  it("is not satisfied by a LIMIT inside a subquery", () => {
    expect(guardReadQuery("SELECT sku FROM (SELECT sku FROM t LIMIT 5) x", 50).sql).toBe("SELECT sku FROM (SELECT sku FROM t LIMIT 5) x LIMIT 50");
  });
});

describe("guardWriteStatement", () => {
  it.each([
    ["INSERT INTO cms_block (title, identifier) VALUES (?, ?)", "insert"],
    ["insert into cms_block (title) select title from cms_block where block_id = 1", "insert"],
    ["UPDATE cms_block SET title = ? WHERE block_id = ?", "update"],
    ["DELETE FROM cms_block WHERE block_id = ?;", "delete"],
  ])("accepts %s", (sql, kind) => {
    expect(guardWriteStatement(sql).kind).toBe(kind);
  });

  it("drops a trailing semicolon", () => {
    expect(guardWriteStatement("DELETE FROM cms_block WHERE block_id = 1;").sql).toBe("DELETE FROM cms_block WHERE block_id = 1");
  });

  it.each([
    ["an UPDATE without WHERE", "UPDATE cms_block SET title = 'x'"],
    ["a DELETE without WHERE", "DELETE FROM cms_block"],
    ["a WHERE that only appears inside a subquery", "UPDATE cms_block SET title = (SELECT title FROM cms_block WHERE block_id = 1)"],
    ["REPLACE", "REPLACE INTO cms_block (block_id) VALUES (1)"],
    ["DROP", "DROP TABLE cms_block"],
    ["TRUNCATE", "TRUNCATE TABLE cms_block"],
    ["ALTER", "ALTER TABLE cms_block ADD x INT"],
    ["CREATE", "CREATE TABLE x (a INT)"],
    ["GRANT", "GRANT ALL ON *.* TO 'a'@'b'"],
    ["a SELECT", "SELECT 1"],
    ["two statements", "DELETE FROM cms_block WHERE block_id = 1; DELETE FROM cms_page WHERE page_id = 1"],
    ["a comment", "DELETE FROM cms_block WHERE block_id = 1 -- all"],
    ["INTO OUTFILE", "INSERT INTO cms_block (title) SELECT 'x' INTO OUTFILE '/tmp/x'"],
    ["SLEEP", "UPDATE cms_block SET title = SLEEP(1) WHERE block_id = 1"],
    ["the administrators table", "UPDATE admin_user SET is_active = 1 WHERE user_id = 1"],
    ["an OAuth table", "DELETE FROM oauth_token WHERE entity_id = 1"],
    ["LOAD DATA", "LOAD DATA INFILE '/tmp/x' INTO TABLE cms_block"],
  ])("refuses %s", (_name, sql) => {
    expect(() => guardWriteStatement(sql)).toThrow(SqlGuardError);
  });
});
