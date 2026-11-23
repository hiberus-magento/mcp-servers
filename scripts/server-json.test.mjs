// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A package that ships a `server.json` (the MCP registry's server manifest) must ship a valid one that agrees with
// its package.json: an MCP host such as Kora installs the npm package, reads `server.json` from its root, builds its
// configuration form from `environmentVariables`, and refuses the package if the file is missing, invalid or does
// not match (`mcpName`, identifier, version). The schema is vendored (schema/mcp-server.2025-12-11.schema.json) so
// this test never needs the network.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCHEMA_URL = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const schema = JSON.parse(readFileSync(join(ROOT, "schema", "mcp-server.2025-12-11.schema.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "servers.json"), "utf8"));

// Names a host will not pass to a child process, or that would change how it runs.
const RESERVED = /^(PATH|HOME|LOGNAME|SHELL|TERM|USER|NODE_.*|NPM_CONFIG_.*|LD_.*)$/;

// Variables optional for a person (servers.json) but required in server.json. MAGENTO_REST_TOKEN may come from the
// credential file `hiberus-magento-rest auth token set` writes, but a host runs the server with an empty HOME and
// only the variables it declares, so for a host the variable is the only source.
const REQUIRED_FOR_A_HOST = { "magento-rest": ["MAGENTO_REST_TOKEN"] };

const packagesWithServerJson = readdirSync(join(ROOT, "packages")).filter((dir) => existsSync(join(ROOT, "packages", dir, "server.json")));

const read = (dir, file) => JSON.parse(readFileSync(join(ROOT, "packages", dir, file), "utf8"));

describe("server.json", () => {
  it("ships in magento-rest", () => {
    expect(packagesWithServerJson).toContain("magento-rest");
  });

  describe.each(packagesWithServerJson)("%s", (dir) => {
    const server = read(dir, "server.json");
    const pkg = read(dir, "package.json");
    const entry = manifest.servers.find((s) => s.package === pkg.name);

    it("is valid against the schema it declares", () => {
      expect(server.$schema).toBe(SCHEMA_URL);
      const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
      expect(validate(server), JSON.stringify(validate.errors)).toBe(true);
    });

    it("agrees with package.json: mcpName, identifier and version, and is in the published files", () => {
      expect(server.name).toBe(pkg.mcpName);
      expect(server.version).toBe(pkg.version);
      expect(server.packages).toHaveLength(1);
      expect(server.packages[0]).toMatchObject({ registryType: "npm", identifier: pkg.name, version: pkg.version, transport: { type: "stdio" } });
      expect(pkg.files).toContain("server.json");
    });

    it("configures the server through environment variables only, in a form a host can render", () => {
      const pack = server.packages[0];
      expect(pack.runtimeArguments).toBeUndefined();
      expect(pack.packageArguments).toBeUndefined();
      for (const variable of pack.environmentVariables) {
        expect(variable.name, variable.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
        expect(variable.name, variable.name).not.toMatch(RESERVED);
        expect(variable.value, variable.name).toBeUndefined();
        expect(variable.variables, variable.name).toBeUndefined();
        expect(variable.format, variable.name).not.toBe("filepath");
        if (/TOKEN|PASSWORD|SECRET/.test(variable.name)) {
          expect(variable.isSecret, variable.name).toBe(true);
        }
      }
    });

    it("declares only variables the server reads (the ones servers.json documents), required where servers.json says so", () => {
      const documented = new Map(entry.requires.env.map((variable) => [variable.name, variable]));
      for (const variable of server.packages[0].environmentVariables) {
        expect(documented.has(variable.name), variable.name).toBe(true);
        if (REQUIRED_FOR_A_HOST[dir]?.includes(variable.name) === true) continue;
        expect(variable.isRequired === true, `${variable.name} isRequired`).toBe(documented.get(variable.name).required);
      }
    });
  });
});

describe("magento-rest's server.json, as Kora configures it", () => {
  const server = read("magento-rest", "server.json");
  const variables = server.packages[0].environmentVariables;

  it("declares the base URL and the token as required, the token secret, groups optional, and the host write switch", () => {
    expect(variables.map((variable) => variable.name)).toEqual(["MAGENTO_REST_BASE_URL", "MAGENTO_REST_TOKEN", "MAGENTO_REST_GROUPS", "MCP_WRITES_ENABLED"]);
    expect(variables[0]).toMatchObject({ isRequired: true });
    expect(variables[1]).toMatchObject({ isRequired: true, isSecret: true });
    expect(variables[2]).toMatchObject({ isRequired: false });
    expect(variables[3]).toMatchObject({ format: "boolean", default: "false", choices: ["true", "false"] });
  });

  // Anything declared becomes a field an administrator can set: these would let writes, customer data or SQL
  // bypass the host's own controls.
  it("does not declare the standalone write switch, customer data, the field file or the database", () => {
    for (const name of ["MAGENTO_REST_ALLOW_WRITES", "MAGENTO_REST_CUSTOMER_DATA", "MAGENTO_REST_FIELDS_FILE", "MAGENTO_REST_DATABASE_CONNECTION", "MAGENTO_REST_DATABASE_PASSWORD", "MAGENTO_REST_DATABASE_ALLOW_WRITES"]) {
      expect(variables.map((variable) => variable.name)).not.toContain(name);
    }
  });
});
