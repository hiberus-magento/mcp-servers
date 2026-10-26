// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The connection string is committed to project repositories (it is in `templates/mcp.json`), so what
// it may contain is a safety property: no password, a scheme this driver speaks, TLS for any host that is not
// this machine, and nothing the parser does not understand.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATABASE_PASSWORD_ENV_VAR, DatabaseConfigError, parseDatabaseConnection, resolveDatabasePassword } from "./connection.js";

describe("parseDatabaseConnection", () => {
  it("reads host, port, user and database", () => {
    expect(parseDatabaseConnection("mysql://reader@db.internal.example:3307/shop?ssl=true")).toEqual({ host: "db.internal.example", port: 3307, user: "reader", database: "shop", ssl: true });
  });

  it("defaults the port, and accepts the mariadb scheme", () => {
    expect(parseDatabaseConnection("mariadb://reader@127.0.0.1/shop")).toMatchObject({ host: "127.0.0.1", port: 3306 });
  });

  it("uses TLS by default for a host that is not this machine, and not for one that is", () => {
    expect(parseDatabaseConnection("mysql://u@db.internal.example/shop").ssl).toBe(true);
    expect(parseDatabaseConnection("mysql://u@localhost/shop").ssl).toBe(false);
    expect(parseDatabaseConnection("mysql://u@127.0.0.1/shop").ssl).toBe(false);
    expect(parseDatabaseConnection("mysql://u@[::1]/shop").ssl).toBe(false);
  });

  it("lets the operator say, explicitly, that a remote host has no TLS", () => {
    expect(parseDatabaseConnection("mysql://u@db.internal.example/shop?ssl=false").ssl).toBe(false);
  });

  it.each([
    ["a password in the string", "mysql://u:secret@localhost/shop", /password/i],
    ["an empty password marker", "mysql://u:@localhost/shop", /password/i],
    ["another scheme", "postgres://u@localhost/shop", /mysql/],
    ["no user", "mysql://localhost/shop", /user/i],
    ["no database", "mysql://u@localhost", /database/i],
    ["an unknown option", "mysql://u@localhost/shop?multipleStatements=true", /multipleStatements/],
    ["a bad ssl value", "mysql://u@localhost/shop?ssl=maybe", /ssl/],
    ["something that is not a URL", "u@localhost/shop", /MAGENTO_REST_DATABASE_CONNECTION/],
    ["a port out of range", "mysql://u@localhost:99999/shop", /port/i],
  ])("refuses %s", (_name, value, message) => {
    expect(() => parseDatabaseConnection(value)).toThrow(DatabaseConfigError);
    expect(() => parseDatabaseConnection(value)).toThrow(message);
  });

  it("never echoes a password back in the error", () => {
    try {
      parseDatabaseConnection("mysql://u:hunter2hunter2@localhost/shop");
    } catch (error) {
      expect((error as Error).message).not.toContain("hunter2");
    }
  });
});

describe("resolveDatabasePassword", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[DATABASE_PASSWORD_ENV_VAR];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[DATABASE_PASSWORD_ENV_VAR];
    else process.env[DATABASE_PASSWORD_ENV_VAR] = saved;
  });

  it("reads the environment variable", () => {
    process.env[DATABASE_PASSWORD_ENV_VAR] = "synthetic-db-pw";
    expect(resolveDatabasePassword("/nonexistent-dir")).toBe("synthetic-db-pw");
  });

  it("names the variable and the command when there is none", () => {
    delete process.env[DATABASE_PASSWORD_ENV_VAR];
    expect(() => resolveDatabasePassword("/nonexistent-dir")).toThrow(DATABASE_PASSWORD_ENV_VAR);
    expect(() => resolveDatabasePassword("/nonexistent-dir")).toThrow(/auth db-password set/);
  });
});
