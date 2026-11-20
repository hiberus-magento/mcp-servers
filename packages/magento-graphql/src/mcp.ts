#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// hiberus-magento-graphql-mcp — an MCP server for the Magento 2 GraphQL API, following the
// architecture `magento-rest` established. Imports ONLY the stdio and web-standard HTTP transport
// deep paths from the SDK — never the package barrel, never `server/index.js` and never the Node
// `streamableHttp.js` (which imports hono) — so this package's bundle stays clean of
// express/hono/ajv/etc. HTTP mode (MAGENTO_GRAPHQL_HTTP_PORT) is opt-in; stdio stays the default.
//
// Intentionally thin: the tool definitions live in `./tools/`, which has no side effects on
// import, so unit tests can import them. This file registers them and connects the transport
// UNCONDITIONALLY at module top level — the shared fd-1 conformance probe `await import()`s this
// exact built bundle and relies on the connect having already run.
//
// Mutation tools are registered ONLY when MAGENTO_GRAPHQL_ALLOW_WRITES=true, read once, here, at
// startup (see `tools/index.ts`); that the server came up in write mode is logged to stderr.
// MAGENTO_GRAPHQL_GROUPS limits which tool groups are registered; an unknown group stops the
// server with exit code 1 and the reason on stderr, before anything is written to fd 1.
import { createStdioServer, logger, readHttpConfig, serverVersion, startHttpEndpoint } from "@hiberus-magento/mcp-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { createMagentoGraphqlTools, unsupportedTools, type MagentoGraphqlTool } from "./tools/index.js";
import { createRuntimeResolver, readGroupsFromEnv, toErrorResult, writesEnabled } from "./tools/runtime.js";

// The SDK constructs a real `AjvJsonSchemaValidator` at server-construction time unless an
// explicit `jsonSchemaValidator` is supplied. After the packaging gate aliases `ajv`/`ajv-formats`
// to throwing stubs, the default constructor would crash this server at startup. This server
// declares no `elicitation` capability and never calls `elicitInput`, so `getValidator()` is
// provably unreachable.
const noElicitationValidator = {
  getValidator() {
    return () => {
      throw new McpError(ErrorCode.InvalidRequest, "elicitation is not supported by stdio servers");
    };
  },
};

function loadGroups(): readonly string[] {
  try {
    return readGroupsFromEnv();
  } catch (error) {
    logger.error(`magento-graphql: refusing to start — ${error instanceof Error ? error.message : "invalid tool groups"}`);
    // Before the stdout guard and the transport exist, so nothing has been written to fd 1.
    process.exit(1);
  }
}

const groups = loadGroups();
const writes = writesEnabled();
// Once the first fixed-document call has read the connected store's schema, every tool whose operation
// the store lacks is disabled (design D14). Before that — and on a store whose schema cannot be read —
// such a tool answers, on a call, that the store does not offer its operation.
// The set is process-wide because HTTP mode builds a fresh server per request (see `buildServer`): each
// new server starts with these tools disabled. The long-lived stdio server is updated in place and sent
// one notifications/tools/list_changed, so a client that honours it stops listing them; a stateless
// HTTP caller has no stream to notify and simply sees the shorter list on its next tools/list.
const unsupportedNames = new Set<string>();
let stdioHandles: Map<string, { enabled: boolean }> | undefined;
let stdioServer: McpServer | undefined;
let toolsAssembled: readonly MagentoGraphqlTool[] = [];
const getRuntime = createRuntimeResolver({
  onSchema: (offers) => {
    const unsupported = unsupportedTools(toolsAssembled, offers);
    for (const name of unsupported) unsupportedNames.add(name);
    // `disable()` would send one notification per tool; turn them all off, then tell the client once.
    let changed = false;
    for (const name of unsupported) {
      const handle = stdioHandles?.get(name);
      if (handle?.enabled === true) {
        handle.enabled = false;
        changed = true;
      }
    }
    if (changed) stdioServer?.sendToolListChanged();
    if (unsupported.length > 0) {
      logger.warn(`magento-graphql: the connected store does not offer the operations of ${unsupported.length} tool(s); they are disabled.`);
    }
  },
});

function assembleTools(): readonly MagentoGraphqlTool[] {
  try {
    return createMagentoGraphqlTools({ getRuntime, writesEnabled: writes, groups });
  } catch (error) {
    // A tool document the operation guard refuses stops the server rather than failing on a call.
    logger.error(`magento-graphql: refusing to start — ${error instanceof Error ? error.message : "invalid tool configuration"}`);
    process.exit(1);
  }
}

// Assembled once: HTTP mode needs a fresh `McpServer` per request, so the tools are shared across
// requests rather than rebuilt for each one.
toolsAssembled = assembleTools();

function buildServer(): { server: McpServer; handles: Map<string, { enabled: boolean }> } {
  const server = new McpServer({ name: "magento-graphql", version: serverVersion() }, { jsonSchemaValidator: noElicitationValidator });
  const handles = new Map<string, { enabled: boolean }>();
  for (const tool of toolsAssembled) {
    const handle = server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema.shape, annotations: tool.annotations },
      async (args: unknown, extra) => {
        try {
          // The SDK aborts `extra.signal` when the client sends notifications/cancelled for this call.
          const result = await tool.invoke(args, { signal: extra.signal });
          return { content: [...result.content], isError: result.isError };
        } catch (error) {
          // `defineTool.invoke` already answers a missing credential; anything else (a classified
          // Magento failure, a refused document, an invalid argument, a configuration error) is
          // rendered here with credential-shaped values redacted, so no failure path returns a raw upstream body.
          const rendered = toErrorResult(error);
          return { content: [...rendered.content], isError: rendered.isError };
        }
      },
    );
    // Set directly, not through `disable()`: nothing is connected yet, so there is no one to notify.
    if (unsupportedNames.has(tool.name)) handle.enabled = false;
    handles.set(tool.name, handle);
  }
  return { server, handles };
}

if (groups.length > 0) {
  logger.warn(`magento-graphql: only these tool groups are loaded (MAGENTO_GRAPHQL_GROUPS) — ${groups.join(", ")}`);
}

if (writes) {
  logger.warn("magento-graphql: mutation tools are ENABLED (MAGENTO_GRAPHQL_ALLOW_WRITES=true); this server can change carts, accounts, wish lists and place orders.");
}

// Spelled out here as literals so scripts/manifest-env.mjs can match them to servers.json.
const HTTP_PORT_ENV_VAR = "MAGENTO_GRAPHQL_HTTP_PORT";
const HTTP_TOKEN_ENV_VAR = "MAGENTO_GRAPHQL_HTTP_TOKEN";
const HTTP_HOST_ENV_VAR = "MAGENTO_GRAPHQL_HTTP_HOST";
const HTTP_ALLOWED_HOSTS_ENV_VAR = "MAGENTO_GRAPHQL_HTTP_ALLOWED_HOSTS";
const HTTP_ALLOWED_ORIGINS_ENV_VAR = "MAGENTO_GRAPHQL_HTTP_ALLOWED_ORIGINS";
const HTTP_ENV_NAMES = {
  port: HTTP_PORT_ENV_VAR,
  token: HTTP_TOKEN_ENV_VAR,
  host: HTTP_HOST_ENV_VAR,
  allowedHosts: HTTP_ALLOWED_HOSTS_ENV_VAR,
  allowedOrigins: HTTP_ALLOWED_ORIGINS_ENV_VAR,
};

function loadHttp(): ReturnType<typeof readHttpConfig> {
  try {
    return readHttpConfig(HTTP_ENV_NAMES, process.env);
  } catch (error) {
    logger.error(`magento-graphql: refusing to start — ${error instanceof Error ? error.message : "invalid HTTP configuration"}`);
    process.exit(1);
  }
}

const http = loadHttp();
// Under Docker's default 10 s stop timeout, so requests in flight finish before the container is killed.
const HTTP_SHUTDOWN_GRACE_MS = 5_000;

if (http.enabled) {
  // Opt-in network mode for callers that cannot own a child process (a PHP middleware). Stateless:
  // a new server and transport per request, no session to keep, JSON replies instead of SSE. The
  // bridge in mcp-core owns bind address, bearer auth, Host/Origin screening and the body cap.
  try {
    const endpoint = await startHttpEndpoint({
      token: http.token,
      host: http.host,
      port: http.port,
      allowedHosts: http.allowedHosts,
      allowedOrigins: http.allowedOrigins,
      handler: async (request) => {
        // No `sessionIdGenerator` is what makes the transport stateless (the SDK reads it as undefined).
        const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
        const { server } = buildServer();
        await server.connect(transport);
        try {
          return await transport.handleRequest(request);
        } finally {
          // JSON replies are complete once handleRequest resolves, so nothing is cut short.
          await server.close();
        }
      },
    });
    // As PID 1 in a container Node has no default SIGTERM handler; without this `docker stop` waits and kills.
    // Installed before the "listening" line, so whoever waits for that line can already stop the server.
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.once(signal, () => {
        logger.info(`magento-graphql: ${signal} received, closing the HTTP endpoint`);
        void endpoint.close(HTTP_SHUTDOWN_GRACE_MS).then(() => process.exit(0));
      });
    }
    logger.info(`magento-graphql: listening on http://${endpoint.host}:${endpoint.port}/mcp`);
  } catch (error) {
    logger.error(`magento-graphql: refusing to start — ${error instanceof Error ? error.message : "invalid HTTP configuration"}`);
    process.exit(1);
  }
} else {
  // Install the stdout guard BEFORE connecting: it takes the real stdout handle away from the whole
  // process and hands it back only here, so the transport is the one writer that can reach fd 1.
  const { stdout } = createStdioServer();
  const transport = new StdioServerTransport(process.stdin, stdout);
  const built = buildServer();
  stdioServer = built.server;
  stdioHandles = built.handles;
  await built.server.connect(transport);
}
