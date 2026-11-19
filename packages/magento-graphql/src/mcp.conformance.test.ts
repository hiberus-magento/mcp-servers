// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Runs the shared conformance suite against the BUILT `hiberus-magento-graphql-mcp` bundle, with
// NO `shellOutProbe` — this is a pure-HTTPS server with no `execFile`-based tool. Wired as an
// ordinary `turbo test` step that depends on `build`, so the bundle always exists first.
//
// On top of the shared suite, assertions at the ARTIFACT layer, where "what ships is what was
// designed" is provable: the write switch, the groups, and a refusal to start on a bad
// configuration (exit code 1, reason on stderr, nothing on stdout).
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonRpcClient, describeConformance } from "@hiberus-magento/mcp-testing";
import { introspectionOf } from "./testing/schema-double.js";
import { allMagentoGraphqlTools } from "./tools/index.js";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const serverPath = fileURLToPath(new URL("../dist/mcp.js", import.meta.url));

// This server builds 247 tool input schemas when it starts with every group loaded, so it costs more CPU to start than
// the six-to-nine-tool servers the shared 75 ms was derived from. MAGENTO_GRAPHQL_GROUPS builds only the schemas of the
// groups it names. The figure and how it was derived are in `packages/mcp-testing/src/conformance/cold-start.ts`.
describeConformance({
  serverPath,
  packageDir,
  startupCpuBudget: { ms: 150, reason: "constructs 247 tool input schemas at startup with every group loaded (about 30 ms more CPU than the 95-tool magento-rest, measured; a few groups cost about 65 ms)" },
});

interface ListedTool {
  readonly name: string;
  readonly annotations?: { readonly readOnlyHint?: boolean };
}

const baseEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...(process.env.PATH !== undefined ? { PATH: process.env.PATH } : {}), ...env });

async function listTools(env: NodeJS.ProcessEnv): Promise<{ tools: readonly ListedTool[]; close: () => void }> {
  const client = new JsonRpcClient({ command: process.execPath, args: [serverPath], env: baseEnv(env) });
  await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "magento-graphql-surface", version: "0.0.0" } });
  client.notify("notifications/initialized");
  const result = (await client.request("tools/list")) as { tools: readonly ListedTool[] };
  return { tools: result.tools, close: () => client.close() };
}

const all = allMagentoGraphqlTools();
const reads = all.filter((t) => t.access === "read").map((t) => t.name).sort();
const writes = all.filter((t) => t.access === "write").map((t) => t.name).sort();

describe(`magento-graphql tool surface on the built bundle: ${serverPath}`, () => {
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

  describe("MAGENTO_GRAPHQL_ALLOW_WRITES=true", () => {
    let listed: readonly ListedTool[];
    let close: () => void;
    beforeAll(async () => {
      ({ tools: listed, close } = await listTools({ MAGENTO_GRAPHQL_ALLOW_WRITES: "true" }));
    });
    afterAll(() => close());

    it("serves the read tools and the write tools", () => {
      expect(listed.map((t) => t.name).sort()).toEqual([...reads, ...writes].sort());
    });
  });

  it("serves no write tool for a value other than the exact string true", async () => {
    const { tools, close } = await listTools({ MAGENTO_GRAPHQL_ALLOW_WRITES: "1" });
    try {
      expect(tools.map((t) => t.name).sort()).toEqual(reads);
    } finally {
      close();
    }
  });

  it("serves only the tools of the chosen groups", async () => {
    const { tools, close } = await listTools({ MAGENTO_GRAPHQL_GROUPS: "cms, Store" });
    try {
      const names = tools.map((t) => t.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names.some((n) => n.includes("cms"))).toBe(true);
      expect(names.some((n) => n.includes("store"))).toBe(true);
      expect(names.some((n) => n.includes("product") || n.includes("cart"))).toBe(false);
    } finally {
      close();
    }
  });

  it("answers a call without a base URL by naming the variable", async () => {
    const client = new JsonRpcClient({ command: process.execPath, args: [serverPath], env: baseEnv({}) });
    try {
      await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "no-base-url", version: "0.0.0" } });
      client.notify("notifications/initialized");
      const result = (await client.request("tools/call", { name: "magentographql_get_store_config", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("MAGENTO_GRAPHQL_BASE_URL");
    } finally {
      client.close();
    }
  });

  it("refuses a mutation sent through the generic query tool, without any request leaving the process", async () => {
    // The base URL points at a closed port: if the guard let the mutation through, the answer would be a transport error.
    const client = new JsonRpcClient({ command: process.execPath, args: [serverPath], env: baseEnv({ MAGENTO_GRAPHQL_BASE_URL: "http://127.0.0.1:1/graphql" }) });
    try {
      await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "guard", version: "0.0.0" } });
      client.notify("notifications/initialized");
      const result = (await client.request("tools/call", { name: "magentographql_query", arguments: { query: "mutation { createEmptyCart }" } })) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("queries only");
    } finally {
      client.close();
    }
  });
});

interface Exited {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runUntilExit(env: NodeJS.ProcessEnv, limitMs = 8000): Promise<Exited> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"], env: baseEnv(env) });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    // A server that DID start stays up waiting on stdin; it is killed at the limit and reported as `code: null`.
    const timer = setTimeout(() => child.kill(), limitMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("MAGENTO_GRAPHQL_GROUPS on the built bundle", () => {
  it("refuses to start on a group that does not exist, listing the valid ones", async () => {
    const result = await runUntilExit({ MAGENTO_GRAPHQL_GROUPS: "products,custmers" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MAGENTO_GRAPHQL_GROUPS");
    expect(result.stderr).toContain("custmers");
    expect(result.stderr).toContain("cart");
    expect(result.stdout).toBe("");
  });
});

// Design D12: once the connected store's schema is known, every tool whose operation it lacks is disabled, and the
// client is told the list changed. A loopback HTTP server plays a store that has the store-config query but no B2B.
describe("tools the connected store does not offer, on the built bundle", () => {
  let store: Server;
  let url: string;
  beforeAll(async () => {
    const schema = introspectionOf({ Query: { storeConfig: "StoreConfig" }, StoreConfig: { store_code: "String", locale: "String" } });
    store = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      request.on("end", () => {
        const query = (JSON.parse(body) as { query: string }).query;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ data: query.includes("__schema") ? schema : { storeConfig: { store_code: "demo_store", locale: "en_US" } } }));
      });
    });
    await new Promise<void>((resolve) => store.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(store.address() as AddressInfo).port}/graphql`;
  });
  afterAll(() => new Promise<void>((resolve) => store.close(() => resolve())));

  it("disables them after the first call reads the schema, and sends notifications/tools/list_changed", async () => {
    const home = mkdtempSync(join(tmpdir(), "magento-graphql-adapt-"));
    const client = new JsonRpcClient({ command: process.execPath, args: [serverPath], env: baseEnv({ MAGENTO_GRAPHQL_BASE_URL: url, MAGENTO_GRAPHQL_GROUPS: "store,company", HOME: home, XDG_CONFIG_HOME: home }) });
    try {
      await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "adapt", version: "0.0.0" } });
      client.notify("notifications/initialized");
      const before = ((await client.request("tools/list")) as { tools: readonly ListedTool[] }).tools.map((t) => t.name);
      expect(before).toContain("magentographql_get_company");

      const result = (await client.request("tools/call", { name: "magentographql_get_store_config", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).not.toBe(true);
      expect(result.content[0]?.text).toContain("demo_store");

      const after = ((await client.request("tools/list")) as { tools: readonly ListedTool[] }).tools.map((t) => t.name);
      expect(after).toContain("magentographql_get_store_config");
      expect(after).not.toContain("magentographql_get_company");
      expect(after.some((n) => n.includes("compan"))).toBe(false);
      const notified = client.rawStdoutLines.some((l) => (l.parsed as { method?: string } | undefined)?.method === "notifications/tools/list_changed");
      expect(notified).toBe(true);
    } finally {
      client.close();
    }
  });
});
