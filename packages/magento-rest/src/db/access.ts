// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The database session layer. It owns what is sent to the database and in what order; the driver below it
// (`mysql-driver.ts`) is a thin adapter, injected here so these rules are tested against a fake that records
// every statement.
//
//   READ  — one connection per call. `SET SESSION TRANSACTION READ ONLY` runs before ANY query, so the server
//           itself refuses a write even if a guard rule ever had a hole; a statement timeout is set where the
//           server supports one (MySQL `max_execution_time`, MariaDB `max_statement_time`) and enforced on the
//           client as well. Every statement passes `guardReadQuery` first; a refused one never reaches the driver.
//   WRITE — only when `MAGENTO_REST_DATABASE_ALLOW_WRITES=true`. The statement passes `guardWriteStatement`
//           BEFORE a connection is opened, runs inside a transaction, and is committed only if it is not a dry
//           run and changed no more rows than the caller allowed (`WHERE 1 = 1` rolls back instead of landing).
//
// This is not the security boundary — the database user's grants are. It is what makes a mistake cheap.
import { DatabaseConfigError, type DatabaseTarget } from "./connection.js";
import { sanitizeRows } from "./rows.js";
import { SqlGuardError, guardReadQuery, guardWriteStatement, type WriteKind } from "./sql-guard.js";

export interface RawResult {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  readonly affectedRows?: number;
  readonly insertId?: number;
}

export interface DbConnection {
  query(sql: string, values?: readonly unknown[], timeoutMs?: number): Promise<RawResult>;
  end(): Promise<void>;
  destroy(): void;
}

export interface ConnectOptions {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly ssl: boolean;
  readonly connectTimeoutMs: number;
}

export interface DbDriver {
  connect(options: ConnectOptions): Promise<DbConnection>;
}

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

export interface ReadResult {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
  readonly truncated: boolean;
}

/** Runs one guarded SELECT inside the session; `maxRows` is the cap the guard enforces and the result is cut to. */
export type ReadRunner = (sql: string, params: readonly unknown[], maxRows: number) => Promise<ReadResult>;

export interface WriteOptions {
  readonly dryRun: boolean;
  readonly maxAffected: number;
}

export interface WriteOutcome {
  readonly kind: WriteKind;
  readonly affectedRows: number;
  readonly insertId: number;
  readonly committed: boolean;
}

export interface DatabaseAccess {
  readonly writesEnabled: boolean;
  read<T>(use: (run: ReadRunner) => Promise<T>): Promise<T>;
  write(sql: string, params: readonly unknown[], options: WriteOptions): Promise<WriteOutcome>;
}

export interface DatabaseAccessOptions {
  readonly target: DatabaseTarget;
  /** Called on every connection, never cached, so a password stored while the server runs applies at once. */
  readonly getPassword: () => string;
  readonly writesEnabled: boolean;
  /** The driver, loaded on first use. Defaults to `mysql2`; injected by tests. */
  readonly driver?: () => Promise<DbDriver>;
  readonly queryTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
}

const DEFAULT_QUERY_TIMEOUT_MS = 15_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ECONNRESET", "PROTOCOL_CONNECTION_LOST", "EAI_AGAIN"]);

function toDatabaseError(error: unknown, target: DatabaseTarget): Error {
  if (error instanceof SqlGuardError || error instanceof DatabaseError || error instanceof DatabaseConfigError) {
    return error;
  }
  const code = typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : undefined;
  if (code === "ER_ACCESS_DENIED_ERROR" || code === "ER_DBACCESS_DENIED_ERROR") {
    return new DatabaseError(`The database refused the login (${code}): check the user or password (the user is in MAGENTO_REST_DATABASE_CONNECTION, the password in MAGENTO_REST_DATABASE_PASSWORD or the stored one) and that this user may use "${target.database}".`);
  }
  if (code !== undefined && CONNECTION_CODES.has(code)) {
    return new DatabaseError(`Cannot reach the database at ${target.host}:${target.port} (${code}). Check the host and port in MAGENTO_REST_DATABASE_CONNECTION and that the server accepts connections from this machine.`);
  }
  const detail = (error as { sqlMessage?: unknown } | null)?.sqlMessage ?? (error instanceof Error ? error.message : "unknown failure");
  return new DatabaseError(code !== undefined ? `${code}: ${String(detail)}` : String(detail));
}

export function createDatabaseAccess(options: DatabaseAccessOptions): DatabaseAccess {
  const queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const loadDriver =
    options.driver ??
    (async (): Promise<DbDriver> => {
      // Loaded on the first database call, so a server without a database never pays for the driver.
      const { createMysqlDriver } = await import("./mysql-driver.js");
      return createMysqlDriver();
    });

  async function open(): Promise<DbConnection> {
    const driver = await loadDriver();
    return driver.connect({ ...options.target, password: options.getPassword(), connectTimeoutMs });
  }

  async function close(connection: DbConnection, failed: boolean): Promise<void> {
    if (failed) {
      connection.destroy();
      return;
    }
    try {
      await connection.end();
    } catch {
      connection.destroy();
    }
  }

  return {
    writesEnabled: options.writesEnabled,

    async read<T>(use: (run: ReadRunner) => Promise<T>): Promise<T> {
      let connection: DbConnection | undefined;
      let failed = false;
      try {
        connection = await open();
        const conn = connection;
        await conn.query("SET SESSION TRANSACTION READ ONLY");
        try {
          await conn.query(`SET SESSION max_execution_time = ${queryTimeoutMs}`);
        } catch {
          try {
            await conn.query(`SET SESSION max_statement_time = ${Math.ceil(queryTimeoutMs / 1000)}`);
          } catch {
            // Neither exists on this server; the client-side timeout still applies.
          }
        }
        const run: ReadRunner = async (sql, params, maxRows) => {
          const guarded = guardReadQuery(sql, maxRows);
          const result = await conn.query(guarded.sql, params, queryTimeoutMs);
          const kept = result.rows.slice(0, maxRows);
          return { columns: result.columns, rows: sanitizeRows(result.columns, kept), truncated: result.rows.length > maxRows };
        };
        return await use(run);
      } catch (error) {
        // A statement the guard refused leaves a healthy connection: close it normally.
        failed = !(error instanceof SqlGuardError);
        throw toDatabaseError(error, options.target);
      } finally {
        if (connection !== undefined) {
          await close(connection, failed);
        }
      }
    },

    async write(sql, params, writeOptions): Promise<WriteOutcome> {
      if (!options.writesEnabled) {
        throw new DatabaseError("Database writes are not enabled. Set MAGENTO_REST_DATABASE_ALLOW_WRITES=true and restart to allow INSERT, UPDATE and DELETE.");
      }
      const guarded = guardWriteStatement(sql);
      let connection: DbConnection | undefined;
      let failed = false;
      try {
        connection = await open();
        const conn = connection;
        await conn.query("START TRANSACTION");
        try {
          const result = await conn.query(guarded.sql, params, queryTimeoutMs);
          const affectedRows = result.affectedRows ?? 0;
          if (affectedRows > writeOptions.maxAffected) {
            await conn.query("ROLLBACK");
            throw new DatabaseError(`The statement would change ${affectedRows} rows, more than the ${writeOptions.maxAffected} allowed (max_affected). Nothing was saved; narrow the WHERE clause or raise max_affected on purpose.`);
          }
          if (writeOptions.dryRun) {
            await conn.query("ROLLBACK");
            return { kind: guarded.kind, affectedRows, insertId: result.insertId ?? 0, committed: false };
          }
          await conn.query("COMMIT");
          return { kind: guarded.kind, affectedRows, insertId: result.insertId ?? 0, committed: true };
        } catch (error) {
          if (!(error instanceof DatabaseError)) {
            await conn.query("ROLLBACK").catch(() => undefined);
          }
          throw error;
        }
      } catch (error) {
        failed = true;
        throw toDatabaseError(error, options.target);
      } finally {
        if (connection !== undefined) {
          await close(connection, failed);
        }
      }
    },
  };
}
