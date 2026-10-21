#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// hiberus-magento-cloud-mcp — an MCP server for the magento-cloud domain,
// following the architecture `eds`/`aco` established, and the FIRST server
// in this repository whose tools genuinely shell out to a third-party CLI
// (design.md's preamble). Imports ONLY the stdio transport deep paths from
// the SDK — never the package barrel and never `server/index.js` directly
// (design.md, Decision 1's packaging rationale) — so this package's bundle
// stays clean of express/hono/ajv/etc.
//
// This file is intentionally thin: the nine tool definitions and their
// schemas live in `./tools/magento-cloud-tools.ts`, so the only thing this
// file does is register them (through `invokeMagentoCloudTool`, which
// surfaces the three CLI-failure classifications `defineTool.invoke` does
// not itself catch) and connect the transport UNCONDITIONALLY at module top
// level — required by the shared conformance suite's fd-1 probe.
import { createStdioServer, serverVersion } from "@hiberus-magento/mcp-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { createMagentoCloudRuntimeResolver, createMagentoCloudTools, invokeMagentoCloudTool } from "./tools/magento-cloud-tools.js";

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
    name: "magento-cloud",
    version: serverVersion(),
  },
  {
    jsonSchemaValidator: noElicitationValidator,
  },
);

const getRuntime = createMagentoCloudRuntimeResolver();

for (const tool of createMagentoCloudTools({ getRuntime })) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema.shape, annotations: tool.annotations },
    async (args: unknown) => {
      const result = await invokeMagentoCloudTool(tool, args, {});
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
