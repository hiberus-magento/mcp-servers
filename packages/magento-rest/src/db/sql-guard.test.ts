// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The guard is the only thing standing between an agent's free-form SQL and the database, so it is
// tested as a list of statements that MUST be refused and a list that MUST pass, plus the limit rewriting.
import { describe, expect, it } from "vitest";
import { SqlGuardError, guardReadQuery, guardWriteStatement, isSensitiveTable } from "./sql-guard.js";

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

describe("identifier placeholders (??)", () => {
  // mysql2 formats `??` as a backtick-quoted identifier on the client, so the guard would check `FROM ??` while the
  // server ran `FROM \`admin_user\``. It does so inside double-quoted text too, where the identifier can close the quote.
  it.each([
    ["a table placeholder in a read", "SELECT username FROM ?? LIMIT 5"],
    ["a column placeholder in a read", "SELECT ?? FROM catalog_product_entity"],
    ["a placeholder inside double quotes", 'SELECT sku FROM catalog_product_entity WHERE sku = "??"'],
  ])("refuses %s, naming the reason", (_name, sql) => {
    expect(refused(sql)).toMatch(/identifier placeholder/i);
  });

  it("refuses a table placeholder in a write", () => {
    expect(() => guardWriteStatement("UPDATE ?? SET is_active = 1 WHERE user_id = 1")).toThrow(/identifier placeholder/i);
  });

  it("still accepts value placeholders, in a read and in a write", () => {
    expect(guardReadQuery("SELECT sku, price FROM catalog_product_entity WHERE sku = ? AND type_id = ?", 10).sql).toBe("SELECT sku, price FROM catalog_product_entity WHERE sku = ? AND type_id = ? LIMIT 10");
    expect(guardWriteStatement("UPDATE cms_block SET title = ? WHERE block_id = ?").kind).toBe("update");
  });
});

describe("sensitive tables: prefixed installs and the added tables", () => {
  it.each([
    ["a prefixed administrators table", "SELECT username FROM mg_admin_user"],
    ["a prefixed, backticked OAuth table", "SELECT consumer_id FROM `shop_oauth_token`"],
    ["the two-factor configuration", "SELECT user_id FROM tfa_user_config"],
    ["the session table", "SELECT session_id FROM session"],
    ["the ACL rules", "SELECT role_id FROM authorization_rule"],
    ["the ACL roles, prefixed", "SELECT role_name FROM mg_authorization_role"],
  ])("refuses %s in a read", (_name, sql) => {
    expect(refused(sql)).toMatch(/holds credentials/);
  });

  it("refuses a prefixed or added sensitive table in a write", () => {
    expect(() => guardWriteStatement("UPDATE mg_admin_user SET is_active = 1 WHERE user_id = 1")).toThrow(/mg_admin_user/);
    expect(() => guardWriteStatement("DELETE FROM authorization_rule WHERE rule_id = 1")).toThrow(/holds credentials/);
  });

  it("matches through isSensitiveTable, prefixed or not, and leaves ordinary tables alone", () => {
    expect(["admin_user", "MG_ADMIN_USER", "tfa_user_config", "session", "authorization_rule", "authorization_role"].map(isSensitiveTable)).toEqual([true, true, true, true, true, true]);
    expect(["catalog_product_entity", "sales_order", "admin_user_extra_info"].map(isSensitiveTable)).toEqual([false, false, false]);
  });

  it("still accepts a prefixed ordinary table", () => {
    expect(() => guardReadQuery("SELECT sku FROM mg_catalog_product_entity", 10)).not.toThrow();
  });
});

describe("credential-named identifiers", () => {
  // Result redaction keys on column names, so an alias, an expression or a WHERE clause could read a credential
  // without its name reaching the result. The guard refuses the name wherever it is written outside a string.
  it.each([
    ["an aliased credential column", "SELECT password_hash AS ph FROM customer_entity"],
    ["a credential column inside an expression", "SELECT CONCAT(rp_token) AS t FROM customer_entity"],
    ["a credential column as a WHERE oracle", "SELECT entity_id FROM customer_entity WHERE password_hash LIKE 'a%'"],
    ["a backticked credential column", "SELECT `password_hash` AS ph FROM customer_entity"],
    ["a qualified credential column", "SELECT c.rp_token FROM customer_entity c"],
  ])("refuses %s", (_name, sql) => {
    expect(refused(sql)).toMatch(/credential/i);
  });

  it("refuses a credential column in a write", () => {
    expect(() => guardWriteStatement("UPDATE customer_entity SET firstname = 'x' WHERE password_hash LIKE 'a%'")).toThrow(/credential/i);
  });

  it("still accepts credential-looking words inside string literals, and ordinary columns", () => {
    expect(() => guardReadQuery("SELECT column_name FROM information_schema.columns WHERE column_name = 'password_hash'", 10)).not.toThrow();
    expect(() => guardReadQuery("SELECT sku, price FROM catalog_product_entity", 10)).not.toThrow();
  });
});

describe("locking reads", () => {
  it.each([
    ["FOR SHARE after OFFSET", "SELECT sku FROM t LIMIT 10 OFFSET 5 FOR SHARE"],
    ["FOR UPDATE after OFFSET", "SELECT sku FROM t LIMIT 10 OFFSET 5 FOR UPDATE"],
    ["LOCK IN SHARE MODE after OFFSET", "SELECT sku FROM t LIMIT 10 OFFSET 5 LOCK IN SHARE MODE"],
    ["FOR SHARE after LIMIT", "SELECT sku FROM t LIMIT 10 FOR SHARE"],
    ["FOR SHARE without a LIMIT", "SELECT sku FROM t FOR SHARE"],
  ])("refuses %s", (_name, sql) => {
    expect(refused(sql, 50)).toMatch(/lock/i);
  });

  it("refuses anything else after the OFFSET", () => {
    expect(refused("SELECT sku FROM t LIMIT 10 OFFSET 5 UNION SELECT sku FROM t", 50)).toMatch(/LIMIT/);
  });
});

describe("string literals whose end depends on the server's SQL mode", () => {
  // Where a string ends must not be a matter of opinion: a double quote is a string by default and an identifier
  // under ANSI_QUOTES, and a backslash escapes the next character unless NO_BACKSLASH_ESCAPES is set. A client
  // formatter that disagreed with the guard on either let a value rewrite the statement.
  it.each([
    ["a double-quoted string holding a single quote", `SELECT "'", '?'`],
    ["a plain double-quoted string", `SELECT sku FROM catalog_product_entity WHERE sku = "DEMO-1"`],
  ])("refuses %s, saying values belong in ? params", (_name, sql) => {
    expect(refused(sql)).toMatch(/double quotes.*\? param/i);
  });

  it("refuses the same desync in a write", () => {
    expect(() => guardWriteStatement(`UPDATE cms_block b JOIN (SELECT "'" AS q) d ON '?' WHERE b.block_id = 1`)).toThrow(/double quotes/i);
  });

  it.each([
    ["an escaped quote", "SELECT sku FROM catalog_product_entity WHERE sku = 'a\\'b'"],
    ["a trailing backslash", "SELECT 'a\\\\' AS x"],
  ])("refuses a backslash inside a string literal: %s", (_name, sql) => {
    expect(refused(sql)).toMatch(/backslash.*\? param/i);
  });

  it("still accepts single-quoted literals, a doubled quote inside one, and backticked identifiers", () => {
    expect(() => guardReadQuery("SELECT `sku` FROM catalog_product_entity WHERE sku = 'it''s' AND type_id = 'simple'", 10)).not.toThrow();
  });
});

describe("the star rule is an allowlist", () => {
  // A star that expands to columns reads whatever a table holds, by position, past every name-based rule.
  it.each([
    ["SELECT ALL *", "SELECT ALL * FROM customer_entity"],
    ["SELECT DISTINCTROW *", "SELECT DISTINCTROW * FROM customer_entity"],
    ["SQL_NO_CACHE", "SELECT SQL_NO_CACHE * FROM customer_entity"],
    ["HIGH_PRIORITY", "SELECT HIGH_PRIORITY * FROM customer_entity"],
    ["STRAIGHT_JOIN", "SELECT STRAIGHT_JOIN * FROM customer_entity"],
    ["SQL_CALC_FOUND_ROWS", "SELECT SQL_CALC_FOUND_ROWS * FROM customer_entity"],
    ["SQL_SMALL_RESULT", "SELECT SQL_SMALL_RESULT * FROM customer_entity"],
    ["SQL_BIG_RESULT", "SELECT SQL_BIG_RESULT * FROM customer_entity"],
    ["SQL_BUFFER_RESULT", "SELECT SQL_BUFFER_RESULT * FROM customer_entity"],
    ["two modifiers", "SELECT DISTINCT SQL_NO_CACHE * FROM customer_entity"],
    ["a positional read through a union", "SELECT HEX(c4) AS h FROM (SELECT 1 c1, 2 c2, 3 c3, 4 c4 UNION ALL SELECT ALL * FROM customer_entity) t"],
    ["a parenthesised star", "SELECT (*) FROM customer_entity"],
  ])("refuses %s", (_name, sql) => {
    expect(refused(sql)).toMatch(/\*/);
  });

  it("refuses the TABLE statement, which reads every column like SELECT *", () => {
    expect(refused("SELECT HEX(c4) AS h FROM (SELECT 1 c1, 2 c2, 3 c3, 4 c4 UNION ALL TABLE customer_entity) t")).toMatch(/TABLE/);
    expect(() => guardWriteStatement("INSERT INTO cms_block (title) TABLE customer_entity")).toThrow(/TABLE/);
  });

  it("refuses a star in a write's RETURNING list", () => {
    expect(() => guardWriteStatement("DELETE FROM cms_block WHERE block_id = 1 RETURNING *")).toThrow(SqlGuardError);
  });

  it.each([
    "SELECT COUNT(*) FROM customer_entity",
    "SELECT qty * price AS total FROM sales_order_item",
    "SELECT e.qty * 2 AS d, (qty + 1) * ? AS p, 3 * qty AS t FROM sales_order_item e",
  ])("still accepts %s", (sql) => {
    expect(() => guardReadQuery(sql, 10)).not.toThrow();
  });
});
