#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// eds — an MCP server for the eds domain, scaffolded from
// `templates/server/` (server-manifest spec, "Server Template Scaffold").
// Imports ONLY the stdio transport deep paths from the SDK — never the
// package barrel and never `server/index.js` directly (design.md, Decision
// 1) — so this package's bundle stays clean of express/hono/ajv/etc.
//
// This file is intentionally thin: the fourteen tool definitions and their
// schemas live in `./tools/eds-tools.ts` (see that file's header for why),
// so the only things this file does are read `EDS_PROTECTED_SITES`, register
// the tools and connect the transport UNCONDITIONALLY at module top level — the same way every other
// template-generated server does. That is required by the shared
// domain-independent fd-1 conformance probe, which `await import()`s this
// exact built bundle and relies on the top-level connect having already run
// (mcp-conformance spec, "Stdout Purity Assertion").
import { createStdioServer, serverVersion } from "@hiberus-magento/mcp-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { parseProtectedSites } from "./confirm/protected-sites.js";
import { createEdsTools, createRuntimeResolver } from "./tools/eds-tools.js";

// The SDK constructs a real `AjvJsonSchemaValidator` at server-construction
// time unless an explicit `jsonSchemaValidator` is supplied (server/index.js:51).
// After the packaging gate aliases `ajv`/`ajv-formats` to throwing stubs
// (design.md, Decision 1, rung (b)), the default constructor would crash
// this server at startup. This server declares no `elicitation` capability
// and never calls `elicitInput`, so `getValidator()` is provably unreachable
// — the only caller is the elicitation result path at server/index.js:358.
const noElicitationValidator = {
  getValidator() {
    return () => {
      throw new McpError(ErrorCode.InvalidRequest, "elicitation is not supported by stdio servers");
    };
  },
};

const server = new McpServer(
  {
    name: "eds",
    version: serverVersion(),
  },
  {
    jsonSchemaValidator: noElicitationValidator,
  },
);

const getRuntime = createRuntimeResolver();

// Read once at startup, like every adapter-level setting; `confirm/` and
// `tools/` never touch the environment (design.md, Decision 6).
const protectedSites = parseProtectedSites(process.env.EDS_PROTECTED_SITES);

for (const tool of createEdsTools({ getRuntime, protectedSites })) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema.shape,
      annotations: tool.annotations,
      // Only `eds_apply` has one: `anthropic/requiresUserInteraction` (D3).
      ...(tool.meta !== undefined ? { _meta: { ...tool.meta } } : {}),
    },
    async (args: unknown) => {
      const result = await tool.invoke(args, {});
      return { content: [...result.content], isError: result.isError };
    },
  );
}

// Install the stdout guard BEFORE connecting: it takes the real stdout
// handle away from the whole process and hands it back only here, so the
// transport is the one writer that can reach fd 1. Anything else that writes
// to stdout is diverted to stderr instead of corrupting the JSON-RPC stream.
const { stdout } = createStdioServer();
const transport = new StdioServerTransport(process.stdin, stdout);
await server.connect(transport);
