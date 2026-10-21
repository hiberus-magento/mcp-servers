#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// fixture-server — an MCP server for the testing domain, scaffolded from
// `templates/server/` (server-manifest spec, "Server Template Scaffold").
// Imports ONLY the stdio transport deep paths from the SDK — never the
// package barrel and never `server/index.js` directly (design.md, Decision
// 1) — so this package's bundle stays clean of express/hono/ajv/etc.
import { createStdioServer, serverVersion } from "@hiberus-magento/mcp-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readEchoTool } from "./tools/read-echo.js";

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
    name: "fixture-server",
    version: serverVersion(),
  },
  {
    jsonSchemaValidator: noElicitationValidator,
  },
);

server.registerTool(
  "noop",
  {
    description: "A no-op tool used only to exercise the packaging gate.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  async () => {
    return {
      content: [{ type: "text", text: z.literal("noop").parse("noop") }],
    };
  },
);

server.registerTool(
  readEchoTool.name,
  {
    description: readEchoTool.description,
    inputSchema: readEchoTool.inputSchema.shape,
    annotations: readEchoTool.annotations,
  },
  async (args: z.infer<typeof readEchoTool.inputSchema>) => {
    const result = await readEchoTool.invoke(args, {});
    return { content: [...result.content], isError: result.isError };
  },
);

// Install the stdout guard BEFORE connecting: it takes the real stdout
// handle away from the whole process and hands it back only here, so the
// transport is the one writer that can reach fd 1. Anything else that writes
// to stdout is diverted to stderr instead of corrupting the JSON-RPC stream.
const { stdout } = createStdioServer();
const transport = new StdioServerTransport(process.stdin, stdout);
await server.connect(transport);
