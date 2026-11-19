// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. mysql2's `query()` formats values into the SQL text on the client, with its own idea of where a string
// ends, so the guard could check one statement and the server run another. A statement with values must go to the
// server as a prepared statement (`execute()`), where the server alone decides what is a placeholder. `mysql2` is
// replaced here by a recorder; the adapter is what is under test.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ query: [] as unknown[], execute: [] as unknown[] }));

vi.mock("mysql2/promise", () => ({
  createConnection: async () => ({
    async query(options: unknown) {
      calls.query.push(options);
      return [{ affectedRows: 0, insertId: 0 }, undefined];
    },
    async execute(options: unknown) {
      calls.execute.push(options);
      return [
        [{ v: "x" }],
        [{ name: "v", orgName: "value", table: "c2", orgTable: "core_config_data" }],
      ];
    },
    async end() {},
    destroy() {},
  }),
}));

const { createMysqlDriver } = await import("./mysql-driver.js");

const OPTIONS = { host: "127.0.0.1", port: 3306, user: "reader", password: "synthetic-db-pw", database: "shop", ssl: false, connectTimeoutMs: 1000 } as const;

describe("the mysql2 adapter", () => {
  beforeEach(() => {
    calls.query.length = 0;
    calls.execute.length = 0;
  });

  it("sends a statement with values as a server-side prepared statement, never through the client formatter", async () => {
    const connection = await createMysqlDriver().connect(OPTIONS);
    await connection.query("SELECT sku FROM catalog_product_entity WHERE sku = ? AND entity_id = ? AND x IS ?", ["DEMO-1", 7, null], 500);
    expect(calls.query).toEqual([]);
    expect(calls.execute).toEqual([{ sql: "SELECT sku FROM catalog_product_entity WHERE sku = ? AND entity_id = ? AND x IS ?", values: ["DEMO-1", 7, null], timeout: 500 }]);
  });

  it("prepares a statement given an empty list of values too", async () => {
    const connection = await createMysqlDriver().connect(OPTIONS);
    await connection.query("SELECT sku FROM catalog_product_entity LIMIT 10", [], 500);
    expect(calls.query).toEqual([]);
    expect(calls.execute).toHaveLength(1);
  });

  it("sends a session statement without values as text, with nothing to format", async () => {
    const connection = await createMysqlDriver().connect(OPTIONS);
    await connection.query("SET SESSION TRANSACTION READ ONLY");
    expect(calls.execute).toEqual([]);
    expect(calls.query).toEqual([{ sql: "SET SESSION TRANSACTION READ ONLY" }]);
  });

  it("reports each column's original name, original table and alias", async () => {
    const connection = await createMysqlDriver().connect(OPTIONS);
    const result = await connection.query("SELECT c2.value AS v FROM core_config_data c2", [], 500);
    expect(result).toEqual({ columns: ["v"], origins: [{ name: "value", table: "core_config_data", alias: "c2" }], rows: [{ v: "x" }] });
  });
});
