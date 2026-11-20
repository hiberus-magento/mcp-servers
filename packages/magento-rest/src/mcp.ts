#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// hiberus-magento-rest-mcp — an MCP server for the Magento 2 REST API,
// following the architecture `aco` established. Imports ONLY the stdio and
// web-standard HTTP transport deep paths from the SDK — never the package
// barrel, never `server/index.js` and never the Node `streamableHttp.js`
// (which imports hono) — so this package's bundle stays clean of
// express/hono/ajv/etc. HTTP mode (MAGENTO_REST_HTTP_PORT) is opt-in and
// stateless; stdio stays the default.
//
// Intentionally thin: the tool definitions live in `./tools/`, which has no
// side effects on import, so unit tests can import them. This file registers
// them and connects the transport UNCONDITIONALLY at module top level — the
// shared fd-1 conformance probe `await import()`s this exact built bundle
// and relies on the connect having already run.
//
// Write tools are registered ONLY when MAGENTO_REST_ALLOW_WRITES=true, read
// once, here, at startup (see `tools/index.ts`). That the server came up in
// write mode is logged to stderr so an operator can see it.
//
// MAGENTO_REST_DATABASE_CONNECTION (a URL with no password) adds the `database` tool group; its writes have a
// switch of their own, MAGENTO_REST_DATABASE_ALLOW_WRITES. Both are read once, here, and an invalid value stops
// the server like a bad field file. The driver is loaded on the first database call, never at startup.
//
// MAGENTO_REST_GROUPS limits which tool groups are registered (default: all). It is read once,
// here, and an unknown group name stops the server the same way a bad field file does.
//
// The operator's field additions (MAGENTO_REST_FIELDS_FILE) are read once,
// here, too — and a file that cannot be read or does not validate STOPS the
// server with exit code 1 and the reason on stderr. Starting with fewer
// fields than the operator asked for would be worse than not starting:
// nothing would say the configuration had not applied.
import { createStdioServer, logger, readHttpConfig, serverVersion, startHttpEndpoint } from "@hiberus-magento/mcp-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { FieldConfig } from "./tools/field-config.js";
import { createDatabaseAccess, type DatabaseAccess } from "./db/access.js";
import { resolveDatabasePassword } from "./db/connection.js";
import { createMagentoRestTools, type MagentoRestTool } from "./tools/index.js";
import { createRuntimeResolver, readDatabaseSettingsFromEnv, readFieldConfigFromEnv, readGroupsFromEnv, toErrorResult, writesEnabled } from "./tools/runtime.js";

// The SDK constructs a real `AjvJsonSchemaValidator` at server-construction
// time unless an explicit `jsonSchemaValidator` is supplied. After the
// packaging gate aliases `ajv`/`ajv-formats` to throwing stubs, the default
// constructor would crash this server at startup. This server declares no
// `elicitation` capability and never calls `elicitInput`, so `getValidator()`
// is provably unreachable.
const noElicitationValidator = {
  getValidator() {
    return () => {
      throw new McpError(ErrorCode.InvalidRequest, "elicitation is not supported by stdio servers");
    };
  },
};

function loadFieldConfig(): FieldConfig {
  try {
    return readFieldConfigFromEnv();
  } catch (error) {
    logger.error(`magento-rest: refusing to start — ${error instanceof Error ? error.message : "invalid field configuration"}`);
    // Before the stdout guard and the transport exist, so nothing has been
    // written to fd 1 and the client sees a plain failed start.
    process.exit(1);
  }
}

function loadGroups(): readonly string[] {
  try {
    return readGroupsFromEnv();
  } catch (error) {
    logger.error(`magento-rest: refusing to start — ${error instanceof Error ? error.message : "invalid tool groups"}`);
    process.exit(1);
  }
}

function loadDatabase(): DatabaseAccess | undefined {
  try {
    const settings = readDatabaseSettingsFromEnv();
    // The password is resolved on every connection, not here: a missing one is a tool error with the fix in it.
    return settings === undefined ? undefined : createDatabaseAccess({ target: settings.target, getPassword: () => resolveDatabasePassword(), writesEnabled: settings.writesEnabled });
  } catch (error) {
    logger.error(`magento-rest: refusing to start — ${error instanceof Error ? error.message : "invalid database configuration"}`);
    process.exit(1);
  }
}

const fieldConfig = loadFieldConfig();
const groups = loadGroups();
const database = loadDatabase();

const getRuntime = createRuntimeResolver();
const writes = writesEnabled();

function assembleTools(): readonly MagentoRestTool[] {
  try {
    return createMagentoRestTools({ getRuntime, writesEnabled: writes, fieldConfig, groups, ...(database !== undefined ? { database } : {}) });
  } catch (error) {
    // The one way assembly can fail is a group the configuration cannot satisfy (`database` without a connection).
    logger.error(`magento-rest: refusing to start — ${error instanceof Error ? error.message : "invalid tool configuration"}`);
    process.exit(1);
  }
}

// Assembled once: HTTP mode needs a fresh `McpServer` per request (see `buildServer`), so the
// tools are shared across requests rather than rebuilt for each one.
const tools = assembleTools();

function buildServer(): McpServer {
  const server = new McpServer({ name: "magento-rest", version: serverVersion() }, { jsonSchemaValidator: noElicitationValidator });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema.shape, annotations: tool.annotations },
      async (args: unknown, extra) => {
        try {
          // The SDK aborts `extra.signal` when the client sends notifications/cancelled for this call.
          const result = await tool.invoke(args, { signal: extra.signal });
          return { content: [...result.content], isError: result.isError };
        } catch (error) {
          // `defineTool.invoke` already answers the credential errors; anything
          // else (a classified Magento failure, an invalid argument, a
          // configuration error) is rendered here with credential-shaped
          // values redacted, so no failure path returns a raw upstream body.
          const rendered = toErrorResult(error);
          return { content: [...rendered.content], isError: rendered.isError };
        }
      },
    );
  }
  return server;
}

const changed = Object.entries(fieldConfig).map(([resource, change]) => `${resource} +${change.add?.length ?? 0} -${change.remove?.length ?? 0}`);
if (changed.length > 0) {
  logger.warn(`magento-rest: field changes active (MAGENTO_REST_FIELDS_FILE) — ${changed.join(", ")}`);
}

if (groups.length > 0) {
  logger.warn(`magento-rest: only these tool groups are loaded (MAGENTO_REST_GROUPS) — ${groups.join(", ")}`);
}

if (database !== undefined) {
  logger.warn(`magento-rest: database tools are enabled (MAGENTO_REST_DATABASE_CONNECTION); queries run in a read-only session${database.writesEnabled ? ", and db_execute is ENABLED (MAGENTO_REST_DATABASE_ALLOW_WRITES=true): this server can change database rows." : "."}`);
}

if (writes) {
  logger.warn("magento-rest: write tools are ENABLED (MAGENTO_REST_ALLOW_WRITES=true); this server can change Magento data.");
}

// Spelled out here as literals so scripts/manifest-env.mjs can match them to servers.json.
const HTTP_PORT_ENV_VAR = "MAGENTO_REST_HTTP_PORT";
const HTTP_TOKEN_ENV_VAR = "MAGENTO_REST_HTTP_TOKEN";
const HTTP_HOST_ENV_VAR = "MAGENTO_REST_HTTP_HOST";
const HTTP_ALLOWED_HOSTS_ENV_VAR = "MAGENTO_REST_HTTP_ALLOWED_HOSTS";
const HTTP_ALLOWED_ORIGINS_ENV_VAR = "MAGENTO_REST_HTTP_ALLOWED_ORIGINS";
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
    logger.error(`magento-rest: refusing to start — ${error instanceof Error ? error.message : "invalid HTTP configuration"}`);
    process.exit(1);
  }
}

const http = loadHttp();

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
        const server = buildServer();
        await server.connect(transport);
        try {
          return await transport.handleRequest(request);
        } finally {
          // JSON replies are complete once handleRequest resolves, so nothing is cut short.
          await server.close();
        }
      },
    });
    logger.info(`magento-rest: listening on http://${endpoint.host}:${endpoint.port}/mcp`);
  } catch (error) {
    logger.error(`magento-rest: refusing to start — ${error instanceof Error ? error.message : "invalid HTTP configuration"}`);
    process.exit(1);
  }
} else {
  // Install the stdout guard BEFORE connecting: it takes the real stdout handle
  // away from the whole process and hands it back only here, so the transport
  // is the one writer that can reach fd 1. Anything else that writes to stdout
  // is diverted to stderr instead of corrupting the JSON-RPC stream.
  const { stdout } = createStdioServer();
  const transport = new StdioServerTransport(process.stdin, stdout);
  await buildServer().connect(transport);
}
