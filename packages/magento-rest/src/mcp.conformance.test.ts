// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Runs the shared conformance suite against the BUILT `hiberus-magento-rest-mcp`
// bundle, with NO `shellOutProbe` — this is a pure-HTTPS server with no
// `execFile`-based tool, exactly the case the domain-independent fd-1 probe
// exists for. Wired as an ordinary `turbo test` step that depends on `build`,
// so the bundle always exists before this file runs.
//
// On top of the shared suite, two assertions at the ARTIFACT layer — the layer
// where "what ships is what was designed" is provable:
//
//   - with the write switch unset, `tools/list` carries NO write tool;
//   - with `MAGENTO_REST_ALLOW_WRITES=true`, it carries the write tools too,
//     and every read tool is present in both modes.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JsonRpcClient, describeConformance } from "@hiberus-magento/mcp-testing";
import { allMagentoRestTools } from "./tools/index.js";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const serverPath = fileURLToPath(new URL("../dist/mcp.js", import.meta.url));

// This server builds ninety-five input schemas when its module is evaluated, so
// it costs more CPU to start than the six-to-nine-tool servers the shared 75 ms
// was derived from. The figure and how it was derived are in
// `packages/mcp-testing/src/conformance/cold-start.ts` ("PER-PACKAGE OVERRIDE").
describeConformance({
  serverPath,
  packageDir,
  startupCpuBudget: {
    ms: 100,
    reason: "constructs 95 tool input schemas at import (about 16 ms more CPU than a six-tool server, measured)",
  },
});

interface ListedTool {
  readonly name: string;
  readonly annotations?: { readonly readOnlyHint?: boolean };
}

async function listTools(env: NodeJS.ProcessEnv): Promise<{ tools: readonly ListedTool[]; close: () => void }> {
  const client = new JsonRpcClient({ command: process.execPath, args: [serverPath], env: { ...(process.env.PATH !== undefined ? { PATH: process.env.PATH } : {}), ...env } });
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "magento-rest-surface", version: "0.0.0" } });
  client.notify("notifications/initialized");
  const result = (await client.request("tools/list")) as { tools: readonly ListedTool[] };
  return { tools: result.tools, close: () => client.close() };
}

// The database tools exist only when a database is configured, so the REST surface is what these cases compare.
const isDatabaseTool = (name: string): boolean => name.startsWith("magentorest_db_");
const restTools = allMagentoRestTools().filter((t) => !isDatabaseTool(t.name));
const reads = restTools.filter((t) => t.access === "read").map((t) => t.name).sort();
const writes = restTools.filter((t) => t.access === "write").map((t) => t.name).sort();
const databaseReads = allMagentoRestTools().filter((t) => isDatabaseTool(t.name) && t.access === "read").map((t) => t.name).sort();

describe(`magento-rest tool surface on the built bundle: ${serverPath}`, () => {
  it("declares at least one read and one write tool, so the cases below are not vacuous", () => {
    expect(reads.length).toBeGreaterThan(0);
    expect(writes.length).toBeGreaterThan(0);
  });

  describe("write switch unset (the default)", () => {
    let listed: readonly ListedTool[];
    let close: () => void;
    beforeAll(async () => {
      ({ tools: listed, close } = await listTools({}));
    });
    afterAll(() => close());

    it("serves exactly the read tools and no write tool", () => {
      expect(listed.map((t) => t.name).sort()).toEqual(reads);
      expect(listed.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    });
  });

  describe("MAGENTO_REST_ALLOW_WRITES=true", () => {
    let listed: readonly ListedTool[];
    let close: () => void;
    beforeAll(async () => {
      ({ tools: listed, close } = await listTools({ MAGENTO_REST_ALLOW_WRITES: "true" }));
    });
    afterAll(() => close());

    it("serves the read tools and the write tools", () => {
      expect(listed.map((t) => t.name).sort()).toEqual([...reads, ...writes].sort());
    });
  });

  describe("a value other than the exact string true", () => {
    let listed: readonly ListedTool[];
    let close: () => void;
    beforeAll(async () => {
      ({ tools: listed, close } = await listTools({ MAGENTO_REST_ALLOW_WRITES: "1" }));
    });
    afterAll(() => close());

    it("still serves no write tool", () => {
      expect(listed.map((t) => t.name).sort()).toEqual(reads);
    });
  });
});

// A field configuration is read ONCE, at startup. A file that cannot be read
// or does not validate must stop the server, not start it with fewer fields
// than the operator asked for — nothing would say the configuration had not
// applied. The exit code is the contract, so these spawn the bundle directly
// and read it (`JsonRpcClient` neither exposes the exit code nor stops
// waiting when its child dies).
interface Exited {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runUntilExit(env: NodeJS.ProcessEnv, limitMs = 8000): Promise<Exited> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"], env: { ...(process.env.PATH !== undefined ? { PATH: process.env.PATH } : {}), ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    // A server that DID start stays up waiting on stdin; it is killed at the
    // limit and reported as `code: null`, which no assertion below accepts as "refused".
    const timer = setTimeout(() => child.kill(), limitMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("MAGENTO_REST_FIELDS_FILE on the built bundle", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "magento-rest-fields-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const fileWith = (value: unknown): string => {
    const path = join(dir, "fields.json");
    writeFileSync(path, JSON.stringify(value));
    return path;
  };

  it("refuses to start on a file that tries to add a credential field, saying why", async () => {
    const result = await runUntilExit({ MAGENTO_REST_FIELDS_FILE: fileWith({ product: { add: ["password_hash"] } }) });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MAGENTO_REST_FIELDS_FILE");
    expect(result.stderr).toContain("cannot be added by configuration");
    expect(result.stdout).toBe("");
  });

  it("refuses to start on a file that tries to replace a list, which a configuration may never do", async () => {
    const result = await runUntilExit({ MAGENTO_REST_FIELDS_FILE: fileWith({ product: { replace: ["sku"] } }) });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('only "add" and "remove" are allowed');
  });

  it("refuses to start on a removal of a field that is not on the shipped list, naming it", async () => {
    const result = await runUntilExit({ MAGENTO_REST_FIELDS_FILE: fileWith({ product: { remove: ["weigth"] } }) });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("weigth");
    expect(result.stderr).toContain("not on the shipped list");
    expect(result.stdout).toBe("");
  });

  it("refuses to start on a removal of an identifier the tools chain on", async () => {
    const result = await runUntilExit({ MAGENTO_REST_FIELDS_FILE: fileWith({ product: { remove: ["sku"] } }) });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("identifier");
  });

  it("refuses to start when the file does not exist, naming the path", async () => {
    const missing = join(dir, "nope.json");
    const result = await runUntilExit({ MAGENTO_REST_FIELDS_FILE: missing });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(missing);
  });

  it("starts on a valid file, serves the same tools, and logs which resources were changed", async () => {
    const client = new JsonRpcClient({
      command: process.execPath,
      args: [serverPath],
      env: { ...(process.env.PATH !== undefined ? { PATH: process.env.PATH } : {}), MAGENTO_REST_FIELDS_FILE: fileWith({ product: { add: ["cost", "special_price"], remove: ["weight"] }, website: { add: ["sort_order"] } }) },
    });
    try {
      await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fields-file", version: "0.0.0" } });
      client.notify("notifications/initialized");
      const result = (await client.request("tools/list")) as { tools: readonly ListedTool[] };
      expect(result.tools.map((t) => t.name).sort()).toEqual(reads);
      const stderr = client.stderrChunks.join("");
      expect(stderr).toContain("product +2 -1");
      expect(stderr).toContain("website +1 -0");
    } finally {
      client.close();
    }
  });
});

// Groups and the database are read ONCE, at startup, and a configuration the server cannot satisfy must stop it
// (exit 1, reason on stderr, nothing on stdout) instead of starting with something other than what was asked.
describe("MAGENTO_REST_GROUPS and the database on the built bundle", () => {
  const CLOSED_PORT_DATABASE = "mysql://reader@127.0.0.1:1/shop";

  it("serves only the tools of the chosen groups", async () => {
    const { tools, close } = await listTools({ MAGENTO_REST_GROUPS: "customers, Tax" });
    try {
      const names = tools.map((t) => t.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names.every((n) => /customer|tax/.test(n))).toBe(true);
      expect(names.some((n) => n.includes("customer"))).toBe(true);
      expect(names.some((n) => n.includes("tax"))).toBe(true);
    } finally {
      close();
    }
  });

  it("refuses to start on a group that does not exist, listing the valid ones", async () => {
    const result = await runUntilExit({ MAGENTO_REST_GROUPS: "products,custmers" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MAGENTO_REST_GROUPS");
    expect(result.stderr).toContain("custmers");
    expect(result.stderr).toContain("database");
    expect(result.stdout).toBe("");
  });

  it("refuses to start with the database group chosen and no connection", async () => {
    const result = await runUntilExit({ MAGENTO_REST_GROUPS: "database" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MAGENTO_REST_DATABASE_CONNECTION");
    expect(result.stdout).toBe("");
  });

  it("refuses to start on a connection string that carries a password, and never prints it", async () => {
    const result = await runUntilExit({ MAGENTO_REST_DATABASE_CONNECTION: "mysql://reader:synthetic-embedded-secret@127.0.0.1/shop" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MAGENTO_REST_DATABASE_CONNECTION");
    expect(result.stderr).not.toContain("synthetic-embedded-secret");
    expect(result.stdout).toBe("");
  });

  it("refuses to start with the database write switch and no connection, which would be silently inert", async () => {
    const result = await runUntilExit({ MAGENTO_REST_DATABASE_ALLOW_WRITES: "true" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MAGENTO_REST_DATABASE_ALLOW_WRITES");
  });

  it("adds the database read tools, but not db_execute, even with the REST write switch on", async () => {
    const { tools, close } = await listTools({ MAGENTO_REST_DATABASE_CONNECTION: CLOSED_PORT_DATABASE, MAGENTO_REST_ALLOW_WRITES: "true" });
    try {
      const names = tools.map((t) => t.name);
      for (const name of databaseReads) expect(names).toContain(name);
      expect(names).not.toContain("magentorest_db_execute");
    } finally {
      close();
    }
  });

  it("adds db_execute only with the database write switch", async () => {
    const { tools, close } = await listTools({ MAGENTO_REST_DATABASE_CONNECTION: CLOSED_PORT_DATABASE, MAGENTO_REST_DATABASE_ALLOW_WRITES: "true", MAGENTO_REST_GROUPS: "database" });
    try {
      expect(tools.map((t) => t.name).sort()).toEqual([...databaseReads, "magentorest_db_execute"].sort());
    } finally {
      close();
    }
  });

  // Also proves the lazily loaded driver is really inside the bundle: the call below loads it, and fails the way a
  // real database that is down fails, with the host named and the password nowhere.
  it("answers a call to an unreachable database with a clear error that loaded the bundled driver", async () => {
    const client = new JsonRpcClient({
      command: process.execPath,
      args: [serverPath],
      env: { ...(process.env.PATH !== undefined ? { PATH: process.env.PATH } : {}), MAGENTO_REST_DATABASE_CONNECTION: CLOSED_PORT_DATABASE, MAGENTO_REST_DATABASE_PASSWORD: "synthetic-db-pw" },
    });
    try {
      await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "database-bundle", version: "0.0.0" } });
      client.notify("notifications/initialized");
      const result = (await client.request("tools/call", { name: "magentorest_db_status", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Cannot reach the database at 127.0.0.1:1");
      expect(result.content[0]?.text).not.toContain("synthetic-db-pw");
    } finally {
      client.close();
    }
  });

  it("answers a call without a stored password by saying how to set one", async () => {
    const client = new JsonRpcClient({
      command: process.execPath,
      args: [serverPath],
      env: { ...(process.env.PATH !== undefined ? { PATH: process.env.PATH } : {}), MAGENTO_REST_DATABASE_CONNECTION: CLOSED_PORT_DATABASE, XDG_CONFIG_HOME: tmpdir() + "/magento-rest-no-such-config" },
    });
    try {
      await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "database-bundle", version: "0.0.0" } });
      client.notify("notifications/initialized");
      const result = (await client.request("tools/call", { name: "magentorest_db_status", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("MAGENTO_REST_DATABASE_PASSWORD");
      expect(result.content[0]?.text).toContain("auth db-password set");
    } finally {
      client.close();
    }
  });
});
