#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// hiberus-magento-graphql-mcp — an MCP server for the Magento 2 GraphQL API, following the
// architecture `magento-rest` established. Imports ONLY the stdio transport deep paths from the
// SDK — never the package barrel and never `server/index.js` directly — so this package's bundle
// stays clean of express/hono/ajv/etc.
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
import { createStdioServer, logger, serverVersion } from "@hiberus-magento/mcp-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { createMagentoGraphqlTools, type MagentoGraphqlTool } from "./tools/index.js";
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
const getRuntime = createRuntimeResolver();

const server = new McpServer({ name: "magento-graphql", version: serverVersion() }, { jsonSchemaValidator: noElicitationValidator });

function assembleTools(): readonly MagentoGraphqlTool[] {
  try {
    return createMagentoGraphqlTools({ getRuntime, writesEnabled: writes, groups });
  } catch (error) {
    // A tool document the operation guard refuses stops the server rather than failing on a call.
    logger.error(`magento-graphql: refusing to start — ${error instanceof Error ? error.message : "invalid tool configuration"}`);
    process.exit(1);
  }
}

for (const tool of assembleTools()) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema.shape, annotations: tool.annotations },
    async (args: unknown) => {
      try {
        const result = await tool.invoke(args, {});
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
}

if (groups.length > 0) {
  logger.warn(`magento-graphql: only these tool groups are loaded (MAGENTO_GRAPHQL_GROUPS) — ${groups.join(", ")}`);
}

if (writes) {
  logger.warn("magento-graphql: mutation tools are ENABLED (MAGENTO_GRAPHQL_ALLOW_WRITES=true); this server can change carts, accounts, wish lists and place orders.");
}

// Install the stdout guard BEFORE connecting: it takes the real stdout handle away from the whole
// process and hands it back only here, so the transport is the one writer that can reach fd 1.
const { stdout } = createStdioServer();
const transport = new StdioServerTransport(process.stdin, stdout);
await server.connect(transport);
