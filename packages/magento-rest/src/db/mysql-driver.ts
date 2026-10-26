// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The only file that imports `mysql2`, and only ever loaded through a dynamic `import()` from `access.ts` on the
// first database call — a server with no database configured never evaluates the driver. Everything with a rule
// attached lives in `access.ts`, where it is tested against a fake; this adapter only maps the driver's shapes
// onto `DbConnection` and fixes the connection options that are not up to the operator:
//
//   - `multipleStatements` stays off, so a second statement is a protocol error even if one slipped past the guard;
//   - `LOCAL_FILES` is switched off, so `LOAD DATA LOCAL INFILE` cannot make this process read a file for the server;
//   - the charset is `utf8mb4`, which is what lets the bundle drop the character-set tables (see `src/stubs/`);
//   - dates and big numbers come back as strings, so nothing is silently rounded or turned into a local-time Date;
//   - `ssl: true` means a VERIFIED connection (certificate and host name), TLS 1.2 or newer. Verification is Node's
//     default and is deliberately never mentioned or overridden here: this package has a repository-wide test
//     that no file under src/ names the switch that turns it off.
import { createConnection, type FieldPacket, type ResultSetHeader } from "mysql2/promise";
import type { ConnectOptions, DbConnection, DbDriver, RawResult } from "./access.js";

export function createMysqlDriver(): DbDriver {
  return {
    async connect(options: ConnectOptions): Promise<DbConnection> {
      const connection = await createConnection({
        host: options.host,
        port: options.port,
        user: options.user,
        password: options.password,
        database: options.database,
        charset: "UTF8MB4_UNICODE_CI",
        connectTimeout: options.connectTimeoutMs,
        multipleStatements: false,
        flags: ["-LOCAL_FILES"],
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
        ...(options.ssl ? { ssl: { minVersion: "TLSv1.2" as const } } : {}),
      });
      return {
        async query(sql, values, timeoutMs): Promise<RawResult> {
          const [result, fields] = await connection.query({ sql, values: values as unknown[] | undefined, ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}) });
          if (Array.isArray(result)) {
            return { columns: ((fields ?? []) as FieldPacket[]).map((field) => field.name), rows: result as Record<string, unknown>[] };
          }
          const header = result as ResultSetHeader;
          return { columns: [], rows: [], affectedRows: header.affectedRows, insertId: header.insertId };
        },
        end: () => connection.end(),
        destroy: () => connection.destroy(),
      };
    },
  };
}
