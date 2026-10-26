// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first, against a fake driver that records every statement it is given. What matters here is what is SENT
// to the database, in what order, and what is never sent: a read session is READ ONLY before any query runs, a
// write runs inside a transaction that is committed only when it should be, and a statement the guard refuses
// never reaches the driver at all.
import { describe, expect, it } from "vitest";
import { createDatabaseAccess, DatabaseError, type DbConnection, type DbDriver, type RawResult } from "./access.js";

const TARGET = { host: "127.0.0.1", port: 3306, user: "reader", database: "shop", ssl: false } as const;

interface Fake {
  readonly driver: DbDriver;
  readonly log: string[];
  readonly state: { connects: number; ended: number; destroyed: number; options: unknown };
}

function fake(answer: (sql: string) => RawResult | Error = () => ({ columns: ["n"], rows: [{ n: 1 }] })): Fake {
  const log: string[] = [];
  const state = { connects: 0, ended: 0, destroyed: 0, options: undefined as unknown };
  const connection: DbConnection = {
    async query(sql) {
      log.push(sql);
      const result = answer(sql);
      if (result instanceof Error) throw result;
      return result;
    },
    async end() {
      state.ended += 1;
    },
    destroy() {
      state.destroyed += 1;
    },
  };
  return {
    log,
    state,
    driver: {
      async connect(options) {
        state.connects += 1;
        state.options = options;
        return connection;
      },
    },
  };
}

const access = (f: Fake, writes = false) => createDatabaseAccess({ target: TARGET, getPassword: () => "synthetic-db-pw", writesEnabled: writes, driver: async () => f.driver });

describe("read sessions", () => {
  it("makes the session READ ONLY before any query, runs the guarded query, and closes", async () => {
    const f = fake();
    const result = await access(f).read((run) => run("SELECT n FROM t", [], 10));
    expect(f.log[0]).toMatch(/SET SESSION TRANSACTION READ ONLY/);
    expect(f.log.at(-1)).toBe("SELECT n FROM t LIMIT 10");
    expect(result).toEqual({ columns: ["n"], rows: [{ n: 1 }], truncated: false });
    expect(f.state.ended).toBe(1);
  });

  it("connects with the target, the password, utf8mb4, and a single statement per query", async () => {
    const f = fake();
    await access(f).read((run) => run("SELECT n FROM t", [], 10));
    expect(f.state.options).toMatchObject({ host: "127.0.0.1", port: 3306, user: "reader", password: "synthetic-db-pw", database: "shop", ssl: false });
  });

  it("never sends a statement the guard refuses", async () => {
    const f = fake();
    await expect(access(f).read((run) => run("SELECT 1; DROP TABLE x", [], 10))).rejects.toThrow(/one statement/i);
    expect(f.log.some((s) => /DROP/i.test(s))).toBe(false);
    expect(f.state.ended).toBe(1);
  });

  it("answers more than the cap with the first rows and says it was cut", async () => {
    const f = fake((sql) => (sql.startsWith("SET") ? { columns: [], rows: [] } : { columns: ["n"], rows: [{ n: 1 }, { n: 2 }, { n: 3 }] }));
    const result = await access(f).read((run) => run("SELECT n FROM t", [], 2));
    expect(result).toMatchObject({ rows: [{ n: 1 }, { n: 2 }], truncated: true });
  });

  it("keeps the READ ONLY session even when the statement-timeout setting is not supported", async () => {
    const f = fake((sql) => (/max_execution_time|max_statement_time/.test(sql) ? new Error("Unknown system variable") : { columns: ["n"], rows: [{ n: 1 }] }));
    await expect(access(f).read((run) => run("SELECT n FROM t", [], 10))).resolves.toBeDefined();
  });

  it("closes the connection when the query fails, and reports a DatabaseError without the SQL's data", async () => {
    const f = fake((sql) => (sql.startsWith("SELECT") ? Object.assign(new Error("Table 'shop.nope' doesn't exist"), { code: "ER_NO_SUCH_TABLE" }) : { columns: [], rows: [] }));
    await expect(access(f).read((run) => run("SELECT n FROM nope", [], 10))).rejects.toThrow(DatabaseError);
    await expect(access(f).read((run) => run("SELECT n FROM nope", [], 10))).rejects.toThrow(/ER_NO_SUCH_TABLE/);
    expect(f.state.destroyed + f.state.ended).toBeGreaterThanOrEqual(2);
  });

  it("explains a refused login without echoing the password", async () => {
    const f = fake();
    f.driver.connect = async () => {
      throw Object.assign(new Error("Access denied for user 'reader'@'172.18.0.1' (using password: YES)"), { code: "ER_ACCESS_DENIED_ERROR" });
    };
    const error = await access(f).read((run) => run("SELECT n FROM t", [], 10)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(String((error as Error).message)).toMatch(/user or password/i);
    expect(String((error as Error).message)).not.toContain("synthetic-db-pw");
  });
});

describe("write statements", () => {
  it("runs inside a transaction and commits", async () => {
    const f = fake((sql) => (/^UPDATE/.test(sql) ? { columns: [], rows: [], affectedRows: 2, insertId: 0 } : { columns: [], rows: [] }));
    const outcome = await access(f, true).write("UPDATE cms_block SET title = ? WHERE block_id = ?", ["x", 1], { dryRun: false, maxAffected: 10 });
    expect(f.log).toEqual(["START TRANSACTION", "UPDATE cms_block SET title = ? WHERE block_id = ?", "COMMIT"]);
    expect(outcome).toEqual({ kind: "update", affectedRows: 2, insertId: 0, committed: true });
  });

  it("rolls back on a dry run and says nothing was saved", async () => {
    const f = fake((sql) => (/^DELETE/.test(sql) ? { columns: [], rows: [], affectedRows: 1, insertId: 0 } : { columns: [], rows: [] }));
    const outcome = await access(f, true).write("DELETE FROM cms_block WHERE block_id = 1", [], { dryRun: true, maxAffected: 10 });
    expect(f.log.at(-1)).toBe("ROLLBACK");
    expect(f.log).not.toContain("COMMIT");
    expect(outcome).toMatchObject({ affectedRows: 1, committed: false });
  });

  it("rolls back and refuses when more rows would change than the caller allowed", async () => {
    const f = fake((sql) => (/^DELETE/.test(sql) ? { columns: [], rows: [], affectedRows: 500, insertId: 0 } : { columns: [], rows: [] }));
    await expect(access(f, true).write("DELETE FROM cms_block WHERE 1 = 1", [], { dryRun: false, maxAffected: 10 })).rejects.toThrow(/500.*10/);
    expect(f.log.at(-1)).toBe("ROLLBACK");
    expect(f.log).not.toContain("COMMIT");
  });

  it("rolls back when the statement fails", async () => {
    const f = fake((sql) => (/^INSERT/.test(sql) ? Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }) : { columns: [], rows: [] }));
    await expect(access(f, true).write("INSERT INTO cms_block (title) VALUES ('a')", [], { dryRun: false, maxAffected: 10 })).rejects.toThrow(/ER_DUP_ENTRY/);
    expect(f.log).toContain("ROLLBACK");
    expect(f.log).not.toContain("COMMIT");
  });

  it("never reaches the driver for a statement the guard refuses", async () => {
    const f = fake();
    await expect(access(f, true).write("DELETE FROM cms_block", [], { dryRun: false, maxAffected: 10 })).rejects.toThrow(/WHERE/);
    expect(f.state.connects).toBe(0);
  });

  it("refuses outright when writes were not enabled", async () => {
    const f = fake();
    await expect(access(f, false).write("DELETE FROM cms_block WHERE block_id = 1", [], { dryRun: false, maxAffected: 10 })).rejects.toThrow(/MAGENTO_REST_DATABASE_ALLOW_WRITES/);
    expect(f.state.connects).toBe(0);
  });
});
