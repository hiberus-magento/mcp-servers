// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The database tools run against a fake driver that records every statement, so what is asserted is
// what each tool SENDS (fixed SQL, parameters bound rather than concatenated, caps applied) and what it RETURNS
// (no credential column, no more rows than the cap).
import { describe, expect, it } from "vitest";
import { createDatabaseAccess, type DbDriver, type RawResult } from "../db/access.js";
import { databaseTools } from "./database-tools.js";

const TARGET = { host: "127.0.0.1", port: 3306, user: "reader", database: "shop", ssl: false } as const;

function setup(answer: (sql: string, values: readonly unknown[]) => RawResult | Error, writes = false) {
  const sent: { sql: string; values: readonly unknown[] }[] = [];
  const driver: DbDriver = {
    async connect() {
      return {
        async query(sql, values = []) {
          sent.push({ sql, values });
          if (/^(SET|START|COMMIT|ROLLBACK)/.test(sql)) return { columns: [], rows: [] };
          const result = answer(sql, values);
          if (result instanceof Error) throw result;
          return result;
        },
        async end() {},
        destroy() {},
      };
    },
  };
  const access = createDatabaseAccess({ target: TARGET, getPassword: () => "synthetic-db-pw", writesEnabled: writes, driver: async () => driver });
  const tools = databaseTools(access);
  const call = async (name: string, args: unknown): Promise<{ isError: boolean; body: unknown; text: string }> => {
    const tool = tools.find((t) => t.name === `magentorest_${name}`);
    if (tool === undefined) throw new Error(`no tool ${name}`);
    const result = await tool.invoke(args, {});
    const text = result.content[0]?.text ?? "";
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // plain text
    }
    return { isError: result.isError === true, body, text };
  };
  return { sent, tools, call };
}

const queries = (sent: { sql: string }[]): string[] => sent.map((s) => s.sql).filter((sql) => !/^(SET|START|COMMIT|ROLLBACK)/.test(sql));

describe("the database tool set", () => {
  it("has the eight read tools and one write tool, named and hinted consistently", () => {
    const { tools } = setup(() => ({ columns: [], rows: [] }));
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["db_describe_table", "db_execute", "db_list_tables", "db_magento_tables", "db_product_by_sku", "db_query", "db_recent_orders", "db_stats", "db_status"].map((n) => `magentorest_${n}`).sort(),
    );
    for (const tool of tools) {
      expect(tool.access, tool.name).toBe(tool.name === "magentorest_db_execute" ? "write" : "read");
      expect(tool.annotations.readOnlyHint, tool.name).toBe(tool.access === "read");
      expect(() => tool.inputSchema.parse({ not_declared: 1 }), tool.name).toThrow();
    }
  });
});

describe("db_status", () => {
  it("reports the server, the database, a read-only session and whether writes are enabled", async () => {
    const { call } = setup(() => ({ columns: ["version", "database_name"], rows: [{ version: "10.6.0-MariaDB", database_name: "shop" }] }));
    const r = await call("db_status", {});
    expect(r.body).toEqual({ connected: true, server_version: "10.6.0-MariaDB", database: "shop", session: "read-only", writes_enabled: false });
  });

  it("says why it could not connect, as an error", async () => {
    const driver: DbDriver = {
      async connect() {
        throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3306"), { code: "ECONNREFUSED" });
      },
    };
    const tools = databaseTools(createDatabaseAccess({ target: TARGET, getPassword: () => "x", writesEnabled: false, driver: async () => driver }));
    const status = tools.find((t) => t.name === "magentorest_db_status");
    await expect(status?.invoke({}, {})).rejects.toThrow(/Cannot reach the database at 127.0.0.1:3306/);
  });
});

describe("db_list_tables and db_describe_table", () => {
  it("lists tables, binding the filter as a parameter with LIKE wildcards escaped", async () => {
    const { call, sent } = setup(() => ({ columns: ["name", "approximate_rows", "engine"], rows: [{ name: "catalog_product_entity", approximate_rows: 121, engine: "InnoDB" }] }));
    const r = await call("db_list_tables", { filter: "catalog_product" });
    expect(r.body).toMatchObject({ tables: [{ name: "catalog_product_entity" }] });
    const last = sent.at(-1);
    expect(last?.sql).not.toContain("catalog_product");
    expect(last?.values).toEqual(["%catalog\\_product%"]);
  });

  it("refuses a filter that is not a table-name fragment", async () => {
    const { tools } = setup(() => ({ columns: [], rows: [] }));
    expect(() => tools.find((t) => t.name === "magentorest_db_list_tables")?.inputSchema.parse({ filter: "x'; DROP" })).toThrow();
  });

  it("describes a table's columns, with the name bound", async () => {
    const { call, sent } = setup(() => ({ columns: ["column_name", "column_type"], rows: [{ column_name: "sku", column_type: "varchar(64)" }] }));
    const r = await call("db_describe_table", { table_name: "catalog_product_entity" });
    expect(r.body).toMatchObject({ table: "catalog_product_entity", columns: [{ column_name: "sku" }] });
    expect(sent.at(-1)?.values).toEqual(["catalog_product_entity"]);
  });

  it("says a table does not exist instead of answering with an empty list", async () => {
    const { call } = setup(() => ({ columns: [], rows: [] }));
    const r = await call("db_describe_table", { table_name: "nope" });
    expect(r.text).toMatch(/not found/i);
  });

  it("will not describe a table that holds credentials", async () => {
    const { tools, sent } = setup(() => ({ columns: [], rows: [] }));
    await expect(tools.find((t) => t.name === "magentorest_db_describe_table")?.invoke({ table_name: "admin_user" }, {})).rejects.toThrow(/admin_user/);
    expect(queries(sent)).toEqual([]);
  });

  it("rejects a table name with anything but letters, digits and underscores", () => {
    const { tools } = setup(() => ({ columns: [], rows: [] }));
    expect(() => tools.find((t) => t.name === "magentorest_db_describe_table")?.inputSchema.parse({ table_name: "a`b" })).toThrow();
  });
});

describe("db_query", () => {
  it("runs a guarded SELECT with its parameters and returns columns, rows and the count", async () => {
    const { call, sent } = setup(() => ({ columns: ["sku"], rows: [{ sku: "DEMO-1" }] }));
    const r = await call("db_query", { sql: "SELECT sku FROM catalog_product_entity WHERE type_id = ?", params: ["simple"] });
    expect(r.body).toEqual({ columns: ["sku"], row_count: 1, truncated: false, rows: [{ sku: "DEMO-1" }] });
    expect(sent.at(-1)).toEqual({ sql: "SELECT sku FROM catalog_product_entity WHERE type_id = ? LIMIT 100", values: ["simple"] });
  });

  it("honours max_rows and never sends the statement a guard refuses", async () => {
    const { tools, sent, call } = setup(() => ({ columns: ["sku"], rows: [{ sku: "a" }, { sku: "b" }, { sku: "c" }] }));
    const r = await call("db_query", { sql: "SELECT sku FROM catalog_product_entity", max_rows: 2 });
    expect(r.body).toMatchObject({ row_count: 2, truncated: true });
    const before = queries(sent).length;
    await expect(tools.find((t) => t.name === "magentorest_db_query")?.invoke({ sql: "SELECT * FROM sales_order" }, {})).rejects.toThrow(/column/i);
    expect(queries(sent).length).toBe(before);
  });

  it("does not return the value of a credential column", async () => {
    const { call } = setup(() => ({ columns: ["email", "password_hash"], rows: [{ email: "a@example.test", password_hash: "$2y$10$abcdefghijklmnopqrstuv" }] }));
    const r = await call("db_query", { sql: "SELECT email, password_hash FROM customer_entity" });
    expect(r.text).not.toContain("$2y$");
    expect(r.text).toContain("a@example.test");
  });

  it("caps max_rows at 500 and params at 50", () => {
    const { tools } = setup(() => ({ columns: [], rows: [] }));
    const schema = tools.find((t) => t.name === "magentorest_db_query")?.inputSchema;
    expect(() => schema?.parse({ sql: "SELECT 1", max_rows: 501 })).toThrow();
    expect(() => schema?.parse({ sql: "SELECT 1", params: Array.from({ length: 51 }, () => 1) })).toThrow();
  });
});

describe("the fixed-SQL shortcuts", () => {
  it("db_product_by_sku binds the SKU and returns the first row, or says it was not found", async () => {
    const found = setup(() => ({ columns: ["entity_id", "sku", "qty"], rows: [{ entity_id: 1, sku: "DEMO-1", qty: "10.0000" }] }));
    expect((await found.call("db_product_by_sku", { sku: "DEMO-1" })).body).toMatchObject({ found: true, product: { sku: "DEMO-1" } });
    expect(found.sent.at(-1)?.values).toEqual(["DEMO-1"]);
    const missing = setup(() => ({ columns: [], rows: [] }));
    expect((await missing.call("db_product_by_sku", { sku: "NOPE" })).body).toEqual({ found: false, sku: "NOPE" });
  });

  it("db_recent_orders defaults to 10, caps at 100, and returns only the summary columns", async () => {
    const { call, sent, tools } = setup(() => ({ columns: ["entity_id", "increment_id"], rows: [{ entity_id: 1, increment_id: "000000001" }] }));
    await call("db_recent_orders", {});
    expect(sent.at(-1)?.sql).toMatch(/ORDER BY created_at DESC LIMIT 10$/);
    await call("db_recent_orders", { limit: 100 });
    expect(sent.at(-1)?.sql).toMatch(/LIMIT 100$/);
    expect(() => tools.find((t) => t.name === "magentorest_db_recent_orders")?.inputSchema.parse({ limit: 101 })).toThrow();
    expect(sent.at(-1)?.sql).not.toMatch(/\bpassword|payment|address/i);
  });

  it("db_stats counts the key tables, in one session, and reports a missing one as such", async () => {
    const { call, sent } = setup((sql) => (sql.includes("quote") ? Object.assign(new Error("Table 'shop.quote' doesn't exist"), { code: "ER_NO_SUCH_TABLE" }) : { columns: ["count"], rows: [{ count: 7 }] }));
    const r = await call("db_stats", {});
    expect(r.body).toMatchObject({ catalog_product_entity: 7, sales_order: 7, quote: "table not found" });
    expect(sent.filter((s) => s.sql.startsWith("SET SESSION TRANSACTION READ ONLY")).length).toBe(1);
  });

  it("db_magento_tables marks which of the well-known tables exist", async () => {
    const { call } = setup(() => ({ columns: ["name"], rows: [{ name: "catalog_product_entity" }, { name: "sales_order" }] }));
    const r = (await call("db_magento_tables", {})).body as Record<string, { name: string; exists: boolean }[]>;
    expect(r["products"]?.find((t) => t.name === "catalog_product_entity")?.exists).toBe(true);
    expect(r["products"]?.find((t) => t.name === "catalog_product_entity_varchar")?.exists).toBe(false);
    expect(r["orders"]?.find((t) => t.name === "sales_order")?.exists).toBe(true);
  });
});

describe("db_execute", () => {
  const answer = (sql: string): RawResult => (/^(INSERT|UPDATE|DELETE)/.test(sql) ? { columns: [], rows: [], affectedRows: 1, insertId: 9 } : { columns: [], rows: [] });

  it("commits and reports what changed", async () => {
    const { call, sent } = setup(answer, true);
    const r = await call("db_execute", { sql: "UPDATE cms_block SET title = ? WHERE block_id = ?", params: ["x", 3] });
    expect(r.body).toEqual({ statement: "update", affected_rows: 1, insert_id: 9, committed: true });
    expect(sent.map((s) => s.sql)).toEqual(["START TRANSACTION", "UPDATE cms_block SET title = ? WHERE block_id = ?", "COMMIT"]);
  });

  it("a dry run reports the effect and says nothing was saved", async () => {
    const { call } = setup(answer, true);
    const r = await call("db_execute", { sql: "DELETE FROM cms_block WHERE block_id = 3", dry_run: true });
    expect(r.body).toMatchObject({ statement: "delete", affected_rows: 1, committed: false });
    expect(r.text).toMatch(/dry run|not saved|nothing was saved/i);
  });

  it("refuses when database writes are not enabled, whatever the statement", async () => {
    const { tools } = setup(answer, false);
    await expect(tools.find((t) => t.name === "magentorest_db_execute")?.invoke({ sql: "DELETE FROM cms_block WHERE block_id = 3" }, {})).rejects.toThrow(/MAGENTO_REST_DATABASE_ALLOW_WRITES/);
  });

  it("bounds max_affected to 1..10000", () => {
    const { tools } = setup(answer, true);
    const schema = tools.find((t) => t.name === "magentorest_db_execute")?.inputSchema;
    expect(() => schema?.parse({ sql: "DELETE FROM t WHERE a = 1", max_affected: 0 })).toThrow();
    expect(() => schema?.parse({ sql: "DELETE FROM t WHERE a = 1", max_affected: 10001 })).toThrow();
  });
});
