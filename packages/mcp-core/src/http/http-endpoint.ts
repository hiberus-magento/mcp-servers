// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// HTTP bridge for servers that must be reachable by something that cannot
// own a child process (a PHP middleware, a queue consumer). It is the
// network twin of `createStdioServer`: it owns everything that must be the
// same for every server — bind address, bearer authentication, Host/Origin
// screening, body cap, a generic failure — and nothing about MCP itself.
//
// It deliberately imports nothing from `@modelcontextprotocol/sdk`: the
// server hands in a web-standard `(Request) => Promise<Response>` (the SDK's
// `WebStandardStreamableHTTPServerTransport.handleRequest`). That keeps this
// package SDK-free and keeps hono/express out of every server bundle — the
// packaging gate bans them, and the SDK's Node transport (`streamableHttp.js`)
// would import `@hono/node-server`.
//
// Threat model, since this turns a local process into a network service:
//   - an unauthenticated peer      -> constant-time bearer check, 401
//   - DNS rebinding from a browser -> Host allow-list, and Origin refused by default
//   - a large or endless body      -> hard cap, 413
//   - a handler bug                -> generic 500, detail to stderr only
//   - a client that walks away     -> the handler's reply stream is cancelled
// The bearer token is never logged and never echoed. Each request leaves one
// access-log line on stderr: HTTP method, path, status, JSON-RPC method, tool
// name and duration — never headers, arguments or results.
//
// Only POST is carried. Servers run the transport stateless, with no SSE stream
// to offer, and the MCP spec has such a server answer GET with 405: an empty
// 200 makes a standard client reconnect in a loop, building a server each time.
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { logger } from "../bootstrap/logger.js";

export const MIN_TOKEN_LENGTH = 32;
const DEFAULT_PATH = "/mcp";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const CARRIED_METHOD = "POST";
const BEARER_PREFIX = /^bearer /i;
const MAX_LOGGED_NAME = 100;

export interface HttpEndpointOptions {
  /** Shared secret the caller must present as `Authorization: Bearer <token>`. At least 32 characters. */
  readonly token: string;
  /** Web-standard request handler; for MCP, `transport.handleRequest`. */
  readonly handler: (request: Request) => Promise<Response>;
  /** Interface to bind. Defaults to loopback; widening it is an explicit decision of the operator. */
  readonly host?: string;
  /** Port to bind; `0` picks a free one. */
  readonly port: number;
  /** Request path the bridge serves. Defaults to `/mcp`. */
  readonly path?: string;
  /** Extra `Host` header values to accept, beyond loopback with the bound port (e.g. `magento-graphql:3000`). */
  readonly allowedHosts?: readonly string[];
  /** `Origin` values to accept. By default any request carrying an Origin is refused: servers are not for browsers. */
  readonly allowedOrigins?: readonly string[];
  /** Largest request body accepted, in bytes. Defaults to 1 MiB. */
  readonly maxBodyBytes?: number;
}

export interface HttpEndpoint {
  readonly host: string;
  readonly port: number;
  readonly address: AddressInfo;
  /** Stops listening. Requests in flight get `graceMs` (default 0) to finish before their sockets are closed. */
  close(graceMs?: number): Promise<void>;
}

class BodyTooLargeError extends Error {}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function bearerMatches(header: string | undefined, expected: Buffer): boolean {
  // The scheme name is case-insensitive (RFC 7235); the token itself is not.
  if (header === undefined || !BEARER_PREFIX.test(header)) {
    return false;
  }
  // Hashing first makes both operands the same length, so the comparison is
  // constant-time and does not reveal the token's length either.
  return timingSafeEqual(digest(header.slice("Bearer ".length)), expected);
}

function reply(response: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify({ error: message }));
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    throw new BodyTooLargeError();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.length;
    if (total > limit) {
      throw new BodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function toHeaders(incoming: IncomingMessage["headers"]): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined) {
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

/** A value from the request, made safe for one log line: no newlines, no control characters, bounded. */
function loggable(value: string): string {
  return value.replace(/[^\w./:-]/g, "?").slice(0, MAX_LOGGED_NAME);
}

/** `tools/call <name>`, `tools/list`, `batch(<n>)`, or nothing — never arguments. */
function describeRpc(body: Buffer): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return "";
  }
  if (Array.isArray(parsed)) {
    return `batch(${parsed.length})`;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return "";
  }
  const { method, params } = parsed as { method?: unknown; params?: { name?: unknown } };
  if (typeof method !== "string") {
    return "";
  }
  const name = typeof params?.name === "string" ? ` ${loggable(params.name)}` : "";
  return `${loggable(method)}${name}`;
}

const GONE = Symbol("client gone");

async function relay(response: Response, target: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  target.writeHead(response.status, headers);
  if (response.body === null) {
    target.end();
    return;
  }
  // Streamed, not buffered: a Streamable HTTP reply may be an SSE stream. If the client leaves, a
  // pending read or a wait for `drain` would never finish; cancel the stream instead of hanging on it.
  const reader = response.body.getReader();
  const gone = new Promise<typeof GONE>((resolve) => target.once("close", () => resolve(GONE)));
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), gone]);
      if (next === GONE) {
        await reader.cancel();
        return;
      }
      if (next.done) {
        break;
      }
      if (!target.write(next.value)) {
        const drained = await Promise.race([new Promise<void>((resolve) => target.once("drain", resolve)), gone]);
        if (drained === GONE) {
          await reader.cancel();
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
    target.end();
  }
}

export async function startHttpEndpoint(options: HttpEndpointOptions): Promise<HttpEndpoint> {
  if (options.token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`The HTTP bearer token must be at least ${MIN_TOKEN_LENGTH} characters; generate one with \`openssl rand -hex 32\`.`);
  }
  const expected = digest(options.token);
  const host = options.host ?? DEFAULT_HOST;
  const path = options.path ?? DEFAULT_PATH;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const allowedOrigins = new Set((options.allowedOrigins ?? []).map((origin) => origin.toLowerCase()));
  // Filled once the real port is known (`port: 0` asks the OS).
  const allowedHosts = new Set((options.allowedHosts ?? []).map((value) => value.toLowerCase()));

  // Loaded on first use, not at module load: this file is part of the `mcp-core` barrel, so a static
  // import would put `node:http` (and everything it pulls in) on the startup path of every stdio
  // server, which never serves HTTP. Measured: about 25 ms of CPU on `magento-rest`.
  const { createServer } = await import("node:http");
  const server: Server = createServer((request, response) => {
    const started = performance.now();
    const context = { rpc: "" };
    response.once("close", () => {
      const status = response.statusCode;
      const pathname = loggable((request.url ?? "/").split("?")[0] ?? "/");
      const rpc = context.rpc === "" ? "" : ` ${context.rpc}`;
      const line = `http: ${loggable(request.method ?? "?")} ${pathname} ${status}${rpc} ${Math.round(performance.now() - started)}ms`;
      if (status >= 500) {
        logger.error(line);
      } else if (status >= 400) {
        logger.warn(line);
      } else {
        logger.info(line);
      }
    });
    void handle(request, response, context).catch((error: unknown) => {
      logger.error(`http endpoint: handler failed (${error instanceof Error ? error.constructor.name : "unknown"})`);
      if (!response.headersSent) {
        reply(response, 500, "Internal error");
      } else {
        response.destroy();
      }
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse, context: { rpc: string }): Promise<void> {
    const hostHeader = request.headers.host?.toLowerCase();
    if (hostHeader === undefined || !allowedHosts.has(hostHeader)) {
      reply(response, 403, "Host not allowed");
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin.toLowerCase())) {
      reply(response, 403, "Origin not allowed");
      return;
    }
    if (!bearerMatches(request.headers.authorization, expected)) {
      reply(response, 401, "Unauthorized", { "www-authenticate": 'Bearer realm="mcp"' });
      return;
    }
    const url = new URL(request.url ?? "/", `http://${hostHeader}`);
    if (url.pathname !== path) {
      reply(response, 404, "Not found");
      return;
    }
    const method = request.method ?? "GET";
    if (method !== CARRIED_METHOD) {
      reply(response, 405, "Method not allowed", { allow: CARRIED_METHOD });
      return;
    }

    let body: Buffer;
    try {
      body = await readBody(request, maxBodyBytes);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        reply(response, 413, "Request body too large");
        request.destroy();
        return;
      }
      throw error;
    }
    context.rpc = describeRpc(body);

    const aborted = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) {
        aborted.abort();
      }
    });
    const webRequest = new Request(url, {
      method,
      headers: toHeaders(request.headers),
      body: new Uint8Array(body),
      signal: aborted.signal,
    });
    await relay(await options.handler(webRequest), response);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  for (const name of ["127.0.0.1", "localhost", "[::1]"]) {
    allowedHosts.add(`${name}:${address.port}`);
  }

  return {
    host,
    port: address.port,
    address,
    close: (graceMs = 0) =>
      new Promise<void>((resolve) => {
        // Stop accepting, drop idle keep-alive sockets, and give requests in flight `graceMs` to finish.
        server.close(() => resolve());
        server.closeIdleConnections();
        if (graceMs <= 0) {
          server.closeAllConnections();
        } else {
          setTimeout(() => server.closeAllConnections(), graceMs).unref();
        }
      }),
  };
}
