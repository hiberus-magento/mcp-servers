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
// The bearer token is never logged and never echoed.
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { logger } from "../bootstrap/logger.js";

export const MIN_TOKEN_LENGTH = 32;
const DEFAULT_PATH = "/mcp";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const CARRIED_METHODS: ReadonlySet<string> = new Set(["POST", "GET", "DELETE"]);

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
  close(): Promise<void>;
}

class BodyTooLargeError extends Error {}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function bearerMatches(header: string | undefined, expected: Buffer): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) {
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
  // Streamed, not buffered: a Streamable HTTP reply may be an SSE stream.
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!target.write(value)) {
        await new Promise<void>((resolve) => target.once("drain", resolve));
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
    void handle(request, response).catch((error: unknown) => {
      logger.error(`http endpoint: handler failed (${error instanceof Error ? error.constructor.name : "unknown"})`);
      if (!response.headersSent) {
        reply(response, 500, "Internal error");
      } else {
        response.destroy();
      }
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
    if (!CARRIED_METHODS.has(method)) {
      reply(response, 405, "Method not allowed", { allow: [...CARRIED_METHODS].join(", ") });
      return;
    }

    let body: Buffer | undefined;
    if (method === "POST") {
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
    }

    const aborted = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) {
        aborted.abort();
      }
    });
    const webRequest = new Request(url, {
      method,
      headers: toHeaders(request.headers),
      ...(body === undefined ? {} : { body: new Uint8Array(body) }),
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
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
