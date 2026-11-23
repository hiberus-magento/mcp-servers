// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// HTTP mode of the BUILT bundle (opt-in with MAGENTO_REST_HTTP_PORT). The artifact layer is
// where it is provable that what ships is what was designed: bearer auth in front of the
// transport, the stateless Streamable HTTP contract a PHP middleware relies on, the same tool
// surface as stdio, and a refusal to start without a token.
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allMagentoRestTools } from "./tools/index.js";

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
  const child = spawn(process.execPath, [serverPath], { env: env({ MAGENTO_REST_HTTP_PORT: "0", MAGENTO_REST_HTTP_TOKEN: TOKEN, ...extra }), stdio: ["ignore", "pipe", "pipe"] });
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

const reads = allMagentoRestTools()
  .filter((t) => t.access === "read" && !t.name.startsWith("magentorest_db_"))
  .map((t) => t.name)
  .sort();

describe(`magento-rest HTTP mode on the built bundle: ${serverPath}`, () => {
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

  it("runs a tool call and reports a missing credential by naming the variable", async () => {
    const response = await rpc(running.url, "tools/call", { name: "magentorest_get_store_views", arguments: {} });
    const body = (await response.json()) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toContain("MAGENTO_REST_BASE_URL");
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
describe("magento-rest HTTP mode shuts down on a signal", () => {
  it.each(["SIGTERM", "SIGINT"] as const)("closes the endpoint and exits 0 on %s", async (signal) => {
    const running = await startHttp({});
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => running.child.once("exit", (code, sig) => resolve({ code, signal: sig })));
    running.child.kill(signal);
    expect(await exit).toEqual({ code: 0, signal: null });
  });
});

describe("magento-rest HTTP mode refuses a bad configuration", () => {
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

  it("exits 1 naming MAGENTO_REST_HTTP_TOKEN when the port is set without a token", async () => {
    const result = await runToExit({ MAGENTO_REST_HTTP_PORT: "0" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("MAGENTO_REST_HTTP_TOKEN");
    expect(result.stdout).toBe("");
  });

  it("exits 1 for a token shorter than 32 characters, without echoing it", async () => {
    const result = await runToExit({ MAGENTO_REST_HTTP_PORT: "0", MAGENTO_REST_HTTP_TOKEN: "tooshorttoken" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("at least 32");
    expect(result.stderr).not.toContain("tooshorttoken");
  });
});
