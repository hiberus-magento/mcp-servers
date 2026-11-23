// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Contract of the HTTP bridge: a Node `http` server that authenticates and
// screens every request, then hands a web-standard `Request` to a handler
// (the SDK's `WebStandardStreamableHTTPServerTransport.handleRequest` in the
// servers; a stub here, so `mcp-core` stays free of the SDK).
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startHttpEndpoint, type HttpEndpoint, type HttpEndpointOptions } from "./http-endpoint.js";

const TOKEN = "t".repeat(40);
const RPC = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

const started: HttpEndpoint[] = [];

async function start(overrides: Partial<HttpEndpointOptions> = {}): Promise<{
  endpoint: HttpEndpoint;
  url: string;
  handler: ReturnType<typeof vi.fn>;
}> {
  const handler = vi.fn(async (request: Request) => {
    const body = await request.text();
    return new Response(JSON.stringify({ echoed: body, method: request.method }), {
      status: 200,
      headers: { "content-type": "application/json", "x-handler": "yes" },
    });
  });
  const endpoint = await startHttpEndpoint({ token: TOKEN, handler, port: 0, ...overrides });
  started.push(endpoint);
  return { endpoint, url: `http://127.0.0.1:${endpoint.port}${overrides.path ?? "/mcp"}`, handler };
}

function post(url: string, init: { token?: string | null; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
  if (init.token !== null) {
    headers["authorization"] = `Bearer ${init.token ?? TOKEN}`;
  }
  return fetch(url, { method: "POST", headers, body: init.body ?? RPC });
}

afterEach(async () => {
  await Promise.all(started.splice(0).map((endpoint) => endpoint.close()));
});

describe("startHttpEndpoint — authentication", () => {
  it("rejects a request with no Authorization header and never calls the handler", async () => {
    const { url, handler } = await start();
    const response = await post(url, { token: null });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a wrong token of the same length", async () => {
    const { url, handler } = await start();
    const response = await post(url, { token: "x".repeat(40) });
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a wrong token of a different length", async () => {
    const { url, handler } = await start();
    const response = await post(url, { token: "short" });
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a non-Bearer scheme", async () => {
    const { url, handler } = await start();
    const response = await post(url, { token: null, headers: { authorization: `Basic ${TOKEN}` } });
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts the scheme name in any case (RFC 7235: it is case-insensitive)", async () => {
    const { url, handler } = await start();
    const response = await post(url, { token: null, headers: { authorization: `bearer ${TOKEN}` } });
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("never echoes the expected token in a refusal", async () => {
    const { url } = await start();
    const response = await post(url, { token: "x".repeat(40) });
    expect(await response.text()).not.toContain(TOKEN);
  });
});

describe("startHttpEndpoint — passthrough", () => {
  it("hands the authenticated request to the handler and returns its response untouched", async () => {
    const { url, handler } = await start();
    const response = await post(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-handler")).toBe("yes");
    expect(await response.json()).toEqual({ echoed: RPC, method: "POST" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("answers 404 on any other path without calling the handler", async () => {
    const { url, handler } = await start();
    const response = await post(url.replace("/mcp", "/other"));
    expect(response.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("honours a custom path", async () => {
    const { url } = await start({ path: "/rpc" });
    expect((await post(url)).status).toBe(200);
  });

  it("answers 405 on a method the bridge does not carry", async () => {
    const { url, handler } = await start();
    const response = await fetch(url, { method: "PUT", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(response.status).toBe(405);
    expect(handler).not.toHaveBeenCalled();
  });

  // Stateless servers have no SSE stream to offer. The MCP spec says such a server answers GET with 405;
  // an empty 200 makes the SDK client reconnect forever, and each reconnect builds a whole server.
  it.each(["GET", "DELETE"])("answers 405 with Allow: POST on %s, without calling the handler", async (method) => {
    const { url, handler } = await start();
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream" } });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(handler).not.toHaveBeenCalled();
  });

  it("stops reading the handler's stream when the client goes away mid-reply", async () => {
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024);
    const { endpoint } = await start({
      handler: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull: (controller) => controller.enqueue(chunk),
            cancel: () => {
              cancelled = true;
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    });
    const http = await import("node:http");
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: endpoint.port, path: "/mcp", method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } },
        (res) => {
          // Read nothing, then leave: the server's writes back up and it waits for a drain that never comes.
          res.pause();
          setTimeout(() => {
            req.destroy();
            resolve();
          }, 100);
        },
      );
      req.on("error", () => undefined);
      req.on("close", () => resolve());
      req.end(RPC);
      setTimeout(() => reject(new Error("no response")), 2000);
    });
    await vi.waitFor(() => expect(cancelled).toBe(true), { timeout: 2000 });
  });

  it("answers 413 when the body exceeds the cap, without calling the handler", async () => {
    const { url, handler } = await start({ maxBodyBytes: 64 });
    const response = await post(url, { body: "x".repeat(65) });
    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers a generic 500 when the handler throws, leaking nothing", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const { url } = await start({
        handler: async () => {
          throw new Error(`secret internals ${TOKEN}`);
        },
      });
      const response = await post(url);
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(text).not.toContain("secret internals");
      expect(text).not.toContain(TOKEN);
    } finally {
      stderr.mockRestore();
    }
  });
});

describe("startHttpEndpoint — host and origin screening", () => {
  it("rejects a Host header outside the allowed list (DNS rebinding)", async () => {
    const { url, handler } = await start();
    // `fetch` forbids overriding Host, so use a raw request.
    const http = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        url,
        { method: "POST", headers: { host: "evil.example", authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(RPC);
    });
    expect(status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts the loopback Host with its port by default", async () => {
    const { url } = await start();
    expect((await post(url)).status).toBe(200);
  });

  it("accepts an extra configured host", async () => {
    const { endpoint, handler } = await start({ allowedHosts: ["magento-graphql:3000"] });
    const http = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port: endpoint.port, path: "/mcp", method: "POST", headers: { host: "magento-graphql:3000", authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(RPC);
    });
    expect(status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("rejects any request carrying an Origin by default (browsers are not clients)", async () => {
    const { url, handler } = await start();
    const response = await post(url, { headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts an Origin that was explicitly allowed", async () => {
    const { url } = await start({ allowedOrigins: ["https://tools.example"] });
    expect((await post(url, { headers: { origin: "https://tools.example" } })).status).toBe(200);
  });
});

describe("startHttpEndpoint — access log", () => {
  async function logged(run: (url: string) => Promise<unknown>): Promise<string> {
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      const { url } = await start();
      await run(url);
      return lines.join("");
    } finally {
      stderr.mockRestore();
    }
  }

  it("writes one line per call to stderr: method, status, JSON-RPC method, tool name, duration", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "demo_tool", arguments: { secret_arg: "hidden-value" } } });
    const out = await logged((url) => post(url, { body }));
    expect(out).toMatch(/\[INFO\] http: POST \/mcp 200 tools\/call demo_tool \d+ms\n/);
    expect(out).not.toContain("hidden-value");
    expect(out).not.toContain("secret_arg");
    expect(out).not.toContain(TOKEN);
  });

  it("logs a refusal with its status and no body detail", async () => {
    const out = await logged((url) => post(url, { token: "x".repeat(40) }));
    expect(out).toMatch(/\[WARN\] http: POST \/mcp 401 \d+ms\n/);
    expect(out).not.toContain("x".repeat(40));
  });

  it("cannot be used to forge log lines through the tool name", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "a\n[ERROR] forged", arguments: {} } });
    const out = await logged((url) => post(url, { body }));
    expect(out).not.toContain("\n[ERROR] forged");
  });
});

describe("startHttpEndpoint — startup rules", () => {
  it("refuses a token shorter than 32 characters", async () => {
    await expect(startHttpEndpoint({ token: "short", handler: async () => new Response("ok"), port: 0 })).rejects.toThrow(/at least 32/);
  });

  it("binds to loopback by default", async () => {
    const { endpoint } = await start();
    expect(endpoint.host).toBe("127.0.0.1");
    expect((endpoint.address as AddressInfo).address).toBe("127.0.0.1");
  });

  it("lets a request in flight finish when closed with a grace period", async () => {
    let release: () => void = () => undefined;
    const { endpoint, url } = await start({
      handler: () => new Promise<Response>((resolve) => (release = () => resolve(new Response("done")))),
    });
    const inFlight = post(url);
    await vi.waitFor(() => expect(release).not.toBe(undefined));
    await new Promise((r) => setTimeout(r, 50));
    const closed = endpoint.close(2000);
    release();
    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("done");
    await closed;
  });
});
