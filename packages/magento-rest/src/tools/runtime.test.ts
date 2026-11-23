// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYNTHETIC_MAGENTO_BASE_URL } from "@hiberus-magento/mcp-testing";
import { ZodError, z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MagentoRestError } from "../client/index.js";
import { FieldConfigError } from "./field-config.js";
import { DATABASE_ALLOW_WRITES_ENV_VAR, DATABASE_CONNECTION_ENV_VAR, DatabaseConfigError } from "../db/connection.js";
import { DatabaseError } from "../db/access.js";
import { SqlGuardError } from "../db/sql-guard.js";
import { ALLOW_WRITES_ENV_VAR, BASE_URL_ENV_VAR, CUSTOMER_DATA_ENV_VAR, MCP_WRITES_ENV_VAR, FIELDS_FILE_ENV_VAR, GROUPS_ENV_VAR, createRuntimeResolver, customerDataEnabled, writesSwitchName, readDatabaseSettingsFromEnv, readFieldConfigFromEnv, readGroupsFromEnv, toErrorResult, writesEnabled } from "./runtime.js";

const NAMES = [BASE_URL_ENV_VAR, ALLOW_WRITES_ENV_VAR, MCP_WRITES_ENV_VAR, CUSTOMER_DATA_ENV_VAR, FIELDS_FILE_ENV_VAR, GROUPS_ENV_VAR, DATABASE_CONNECTION_ENV_VAR, DATABASE_ALLOW_WRITES_ENV_VAR] as const;

describe("runtime", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
    for (const n of NAMES) delete process.env[n];
  });
  afterEach(() => {
    for (const [n, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  });

  describe("readDatabaseSettingsFromEnv", () => {
    it("is no database when the connection is unset or empty", () => {
      expect(readDatabaseSettingsFromEnv()).toBeUndefined();
      process.env[DATABASE_CONNECTION_ENV_VAR] = "";
      expect(readDatabaseSettingsFromEnv()).toBeUndefined();
    });
    it("reads the target, with writes off unless exactly `true`", () => {
      process.env[DATABASE_CONNECTION_ENV_VAR] = "mysql://reader@127.0.0.1:3307/shop";
      expect(readDatabaseSettingsFromEnv()).toEqual({ target: { host: "127.0.0.1", port: 3307, user: "reader", database: "shop", ssl: false }, writesEnabled: false });
      for (const value of ["1", "yes", "TRUE", "false"]) {
        process.env[DATABASE_ALLOW_WRITES_ENV_VAR] = value;
        expect(readDatabaseSettingsFromEnv()?.writesEnabled, value).toBe(false);
      }
      process.env[DATABASE_ALLOW_WRITES_ENV_VAR] = "true";
      expect(readDatabaseSettingsFromEnv()?.writesEnabled).toBe(true);
    });
    it("refuses a connection string with a password, without echoing it", () => {
      process.env[DATABASE_CONNECTION_ENV_VAR] = "mysql://reader:hunter2hunter2@127.0.0.1/shop";
      expect(() => readDatabaseSettingsFromEnv()).toThrow(DatabaseConfigError);
      expect(() => readDatabaseSettingsFromEnv()).toThrow(/password/);
    });
    it("refuses the write switch without a connection: it would be silently inert", () => {
      process.env[DATABASE_ALLOW_WRITES_ENV_VAR] = "true";
      expect(() => readDatabaseSettingsFromEnv()).toThrow(new RegExp(`${DATABASE_ALLOW_WRITES_ENV_VAR}.*${DATABASE_CONNECTION_ENV_VAR}`));
    });
  });

  describe("toErrorResult for the database", () => {
    it("shows a database or guard error as its message, redacted", () => {
      expect(toErrorResult(new SqlGuardError("only a SELECT is allowed here")).content[0]?.text).toBe("only a SELECT is allowed here");
      expect(toErrorResult(new DatabaseError("ER_NO_SUCH_TABLE: Table 'shop.x' doesn't exist; password=pw-synthetic")).content[0]?.text).not.toContain("pw-synthetic");
    });
  });

  describe("readGroupsFromEnv", () => {
    it("is no selection when the variable is unset or empty", () => {
      expect(readGroupsFromEnv()).toEqual([]);
      process.env[GROUPS_ENV_VAR] = "";
      expect(readGroupsFromEnv()).toEqual([]);
    });
    it("reads the chosen groups", () => {
      process.env[GROUPS_ENV_VAR] = "products, Customers";
      expect(readGroupsFromEnv()).toEqual(["products", "customers"]);
    });
    it("throws naming the variable when a group is unknown", () => {
      process.env[GROUPS_ENV_VAR] = "products,nope";
      expect(() => readGroupsFromEnv()).toThrow(GROUPS_ENV_VAR);
    });
  });

  describe("createRuntimeResolver", () => {
    it("is lazy: constructing the resolver reads nothing and never throws", () => {
      expect(() => createRuntimeResolver()).not.toThrow();
    });

    it("refuses a call, naming the variable, when the base URL is unset", () => {
      expect(() => createRuntimeResolver()()).toThrow(BASE_URL_ENV_VAR);
    });

    it("refuses an empty base URL the same way", () => {
      process.env[BASE_URL_ENV_VAR] = "";
      expect(() => createRuntimeResolver()()).toThrow(BASE_URL_ENV_VAR);
    });

    it("builds one client and reuses it", () => {
      process.env[BASE_URL_ENV_VAR] = SYNTHETIC_MAGENTO_BASE_URL;
      const resolve = createRuntimeResolver();
      expect(resolve().client).toBe(resolve().client);
    });

    it("surfaces a plaintext base URL as a configuration error at the first call", () => {
      process.env[BASE_URL_ENV_VAR] = "http://demo-host.example-domain/rest/V1";
      expect(() => createRuntimeResolver()()).toThrow(/https/);
    });
  });

  describe("writesEnabled", () => {
    it("is off by default", () => {
      expect(writesEnabled()).toBe(false);
    });

    it.each(["1", "yes", "TRUE", "True", "on", ""])("is still off for %j — only the exact string true enables", (value) => {
      process.env[ALLOW_WRITES_ENV_VAR] = value;
      expect(writesEnabled()).toBe(false);
    });

    it("is on for exactly true", () => {
      process.env[ALLOW_WRITES_ENV_VAR] = "true";
      expect(writesEnabled()).toBe(true);
    });

    // MCP_WRITES_ENABLED is the name an MCP host such as Kora sets itself; MAGENTO_REST_ALLOW_WRITES stays for
    // standalone use. When the host's variable is present it decides alone, so a host that runs a read-only process
    // cannot be overridden by an alias left in the environment.
    it("is on for MCP_WRITES_ENABLED=true", () => {
      expect(MCP_WRITES_ENV_VAR).toBe("MCP_WRITES_ENABLED");
      process.env[MCP_WRITES_ENV_VAR] = "true";
      expect(writesEnabled()).toBe(true);
    });

    it.each(["false", "1", "TRUE", ""])("MCP_WRITES_ENABLED=%j keeps writes off even with MAGENTO_REST_ALLOW_WRITES=true", (value) => {
      process.env[MCP_WRITES_ENV_VAR] = value;
      process.env[ALLOW_WRITES_ENV_VAR] = "true";
      expect(writesEnabled()).toBe(false);
    });

    it("names the variable that decides, so a startup log can say which one turned writes on", () => {
      expect(writesSwitchName()).toBe("MAGENTO_REST_ALLOW_WRITES");
      process.env[MCP_WRITES_ENV_VAR] = "false";
      expect(writesSwitchName()).toBe("MCP_WRITES_ENABLED");
    });

    it("MCP_WRITES_ENABLED=true wins over MAGENTO_REST_ALLOW_WRITES=false", () => {
      process.env[MCP_WRITES_ENV_VAR] = "true";
      process.env[ALLOW_WRITES_ENV_VAR] = "false";
      expect(writesEnabled()).toBe(true);
    });
  });

  describe("customerDataEnabled", () => {
    it("is off by default, so results carry no customer personal data", () => {
      expect(CUSTOMER_DATA_ENV_VAR).toBe("MAGENTO_REST_CUSTOMER_DATA");
      expect(customerDataEnabled()).toBe(false);
    });

    it.each(["1", "yes", "TRUE", "on", ""])("is still off for %j — only the exact string true enables", (value) => {
      process.env[CUSTOMER_DATA_ENV_VAR] = value;
      expect(customerDataEnabled()).toBe(false);
    });

    it("is on for exactly true", () => {
      process.env[CUSTOMER_DATA_ENV_VAR] = "true";
      expect(customerDataEnabled()).toBe(true);
    });
  });

  describe("toErrorResult", () => {
    it("renders a MagentoRestError with its message and remedy, as an error result", () => {
      const result = toErrorResult(new MagentoRestError({ kind: "unauthorized", message: "Magento REST HTTP 401: nope", status: 401, remedy: "Set the token." }));
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Magento REST HTTP 401: nope");
      expect(result.content[0]?.text).toContain("Set the token.");
    });

    it("renders invalid tool arguments readably, with the offending path", () => {
      const parsed = z.object({ sku: z.string().min(1) }).safeParse({ sku: "" });
      const error = parsed.success ? new Error("unreachable") : parsed.error;
      expect(error).toBeInstanceOf(ZodError);
      const text = toErrorResult(error).content[0]?.text ?? "";
      expect(text).toContain("Invalid arguments");
      expect(text).toContain("sku");
    });

    it("never leaks a credential-shaped value from an unexpected error", () => {
      const text = toErrorResult(new Error("boom Authorization: Bearer demo-bearer-99")).content[0]?.text ?? "";
      expect(text).not.toContain("demo-bearer-99");
    });
  });

  describe("readFieldConfigFromEnv", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "magento-rest-fields-"));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    const fileWith = (content: string): string => {
      const path = join(dir, "fields.json");
      writeFileSync(path, content);
      return path;
    };

    it("is an empty configuration when the variable is unset or empty", () => {
      expect(readFieldConfigFromEnv()).toEqual({});
      process.env[FIELDS_FILE_ENV_VAR] = "";
      expect(readFieldConfigFromEnv()).toEqual({});
    });

    it("reads and parses the file the variable points at", () => {
      process.env[FIELDS_FILE_ENV_VAR] = fileWith(JSON.stringify({ product: { add: ["cost"] } }));
      expect(readFieldConfigFromEnv()).toEqual({ product: { add: ["cost"] } });
    });

    it("reads a removal too", () => {
      process.env[FIELDS_FILE_ENV_VAR] = fileWith(JSON.stringify({ product: { remove: ["weight"] } }));
      expect(readFieldConfigFromEnv()).toEqual({ product: { remove: ["weight"] } });
    });

    it("refuses, at startup, a removal that is not on the shipped list, naming the file and the path", () => {
      const path = fileWith(JSON.stringify({ product: { remove: ["weigth"] } }));
      process.env[FIELDS_FILE_ENV_VAR] = path;
      expect(() => readFieldConfigFromEnv()).toThrow(FieldConfigError);
      expect(() => readFieldConfigFromEnv()).toThrow(path);
      expect(() => readFieldConfigFromEnv()).toThrow(/weigth/);
    });

    it("fails, naming the variable and the path, when the file does not exist", () => {
      const missing = join(dir, "nope.json");
      process.env[FIELDS_FILE_ENV_VAR] = missing;
      expect(() => readFieldConfigFromEnv()).toThrow(FieldConfigError);
      expect(() => readFieldConfigFromEnv()).toThrow(FIELDS_FILE_ENV_VAR);
      expect(() => readFieldConfigFromEnv()).toThrow(missing);
    });

    it("fails when the path is a directory", () => {
      mkdirSync(join(dir, "sub"));
      process.env[FIELDS_FILE_ENV_VAR] = join(dir, "sub");
      expect(() => readFieldConfigFromEnv()).toThrow(FieldConfigError);
    });

    it("fails, with the path and the reason, when the content is invalid", () => {
      const path = fileWith(JSON.stringify({ product: { add: ["password_hash"] } }));
      process.env[FIELDS_FILE_ENV_VAR] = path;
      expect(() => readFieldConfigFromEnv()).toThrow(path);
      expect(() => readFieldConfigFromEnv()).toThrow(/cannot be added by configuration/);
    });

    it("refuses a file larger than 64 KB without parsing it", () => {
      process.env[FIELDS_FILE_ENV_VAR] = fileWith(`{"product":{"add":[]}}${" ".repeat(70 * 1024)}`);
      expect(() => readFieldConfigFromEnv()).toThrow(/64 KB/);
    });
  });
});
