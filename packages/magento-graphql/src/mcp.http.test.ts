// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// HTTP mode of the BUILT bundle (opt-in with MAGENTO_GRAPHQL_HTTP_PORT). The artifact layer is
// where it is provable that what ships is what was designed: bearer auth in front of the
// transport, the stateless Streamable HTTP contract a PHP middleware relies on, the same tool
// surface as stdio, and a refusal to start without a token.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { introspectionOf } from "./testing/schema-double.js";
import { allMagentoGraphqlTools } from "./tools/index.js";

const serverPath = fileURLToPath(new URL("../dist/mcp.js", import.meta.url));
const TOKEN = "h".repeat(48);
const ACCEPT = "application/json, text/event-stream";

interface Running {
  readonly child: ChildProcess;
  readonly url: string;
  readonly stdout: () => string;
}

function env(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...(process.env.PATH !== undefined ? { PATH: process.env.PATH } : {}), ...extra };
}

function startHttp(extra: NodeJS.ProcessEnv): Promise<Running> {
  const child = spawn(process.execPath, [serverPath], { env: env({ MAGENTO_GRAPHQL_HTTP_PORT: "0", MAGENTO_GRAPHQL_HTTP_TOKEN: TOKEN, ...extra }), stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });
  return new Promise((resolve, reject) => {
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no "listening" line on stderr within 5s; stderr was: ${err}`));
    }, 5000);
    child.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString();
      const match = /listening on (http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(err);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve({ child, url: match[1], stdout: () => out });
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`exited with ${code} before listening; stderr was: ${err}`));
    });
  });
}

async function rpc(url: string, method: string, params: unknown, token: string | null = TOKEN): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: ACCEPT };
  if (token !== null) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}

const reads = allMagentoGraphqlTools()
  .filter((t) => t.access === "read")
  .map((t) => t.name)
  .sort();

describe(`magento-graphql HTTP mode on the built bundle: ${serverPath}`, () => {
  let running: Running;
  beforeAll(async () => {
    running = await startHttp({});
  });
  afterAll(() => {
    running.child.kill();
  });

  it("answers 401 without the bearer token", async () => {
    expect((await rpc(running.url, "tools/list", {}, null)).status).toBe(401);
  });

  it("answers 401 with a wrong token", async () => {
    expect((await rpc(running.url, "tools/list", {}, "w".repeat(48))).status).toBe(401);
  });

  it("serves the same read tools as stdio, in a JSON reply, with no session header", async () => {
    const response = await rpc(running.url, "tools/list", {});
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const body = (await response.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(reads);
  });

  it("serves many sequential requests (stateless: a new transport each time)", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await rpc(running.url, "tools/list", {})).status).toBe(200);
    }
  });

  it("runs a tool call and reports a missing base URL by naming the variable", async () => {
    const response = await rpc(running.url, "tools/call", { name: "magentographql_get_store_config", arguments: {} });
    const body = (await response.json()) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toContain("MAGENTO_GRAPHQL_BASE_URL");
  });

  it("writes nothing to stdout", () => {
    expect(running.stdout()).toBe("");
  });

  it("answers 405 with Allow: POST to GET, so a standard client does not reconnect in a loop", async () => {
    const response = await fetch(running.url, { headers: { authorization: `Bearer ${TOKEN}`, accept: ACCEPT } });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

// As PID 1 in a container Node has no default SIGTERM handler, so without one `docker stop` waits and kills.
describe("magento-graphql HTTP mode shuts down on a signal", () => {
  it.each(["SIGTERM", "SIGINT"] as const)("closes the endpoint and exits 0 on %s", async (signal) => {
    const running = await startHttp({});
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => running.child.once("exit", (code, sig) => resolve({ code, signal: sig })));
    running.child.kill(signal);
    expect(await exit).toEqual({ code: 0, signal: null });
  });
});

// Design D14 over HTTP: each request builds a fresh server, so the tools a store lacks must be remembered
// process-wide and stay off in every later request, not only in the one that read the schema.
describe("magento-graphql HTTP mode leaves out the tools the connected store does not offer", () => {
  let store: Server;
  let running: Running;
  let home: string;
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
    home = mkdtempSync(join(tmpdir(), "magento-graphql-http-adapt-"));
    running = await startHttp({
      MAGENTO_GRAPHQL_BASE_URL: `http://127.0.0.1:${(store.address() as AddressInfo).port}/graphql`,
      MAGENTO_GRAPHQL_GROUPS: "store,company",
      HOME: home,
      XDG_CONFIG_HOME: home,
    });
  });
  afterAll(async () => {
    running.child.kill();
    await new Promise<void>((resolve) => store.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  });

  async function listed(): Promise<string[]> {
    const body = (await (await rpc(running.url, "tools/list", {})).json()) as { result: { tools: { name: string }[] } };
    return body.result.tools.map((t) => t.name);
  }

  it("lists them until a call reads the schema, then leaves them out of every later request", async () => {
    expect(await listed()).toContain("magentographql_get_company");

    const call = (await (await rpc(running.url, "tools/call", { name: "magentographql_get_store_config", arguments: {} })).json()) as {
      result: { isError?: boolean; content: { text: string }[] };
    };
    expect(call.result.isError).not.toBe(true);
    expect(call.result.content[0]?.text).toContain("demo_store");

    for (let i = 0; i < 2; i++) {
      const after = await listed();
      expect(after).toContain("magentographql_get_store_config");
      expect(after.some((n) => n.includes("compan"))).toBe(false);
    }
  });
});

describe("magento-graphql HTTP mode refuses a bad configuration", () => {
  function runToExit(extra: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string; stdout: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [serverPath], { env: env(extra), stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      let stdout = "";
      child.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
      child.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
      child.once("exit", (code) => resolve({ code, stderr, stdout }));
    });
  }

  it("exits 1 naming MAGENTO_GRAPHQL_HTTP_TOKEN when the port is set without a token", async () => {
    const result = await runToExit({ MAGENTO_GRAPHQL_HTTP_PORT: "0" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MAGENTO_GRAPHQL_HTTP_TOKEN");
    expect(result.stdout).toBe("");
  });

  it("exits 1 for a token shorter than 32 characters, without echoing it", async () => {
    const result = await runToExit({ MAGENTO_GRAPHQL_HTTP_PORT: "0", MAGENTO_GRAPHQL_HTTP_TOKEN: "tooshorttoken" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("at least 32");
    expect(result.stderr).not.toContain("tooshorttoken");
  });
});
