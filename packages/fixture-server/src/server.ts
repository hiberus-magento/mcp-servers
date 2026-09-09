#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Throwaway packaging-gate harness for Phase 2 of mcp-servers-bootstrap.
// Deliberately imports ONLY the stdio transport deep paths from the SDK —
// never the package barrel and never `server/index.js` directly — to prove
// which parts of the SDK's dependency graph a stdio-only server actually
// pulls into a bundle. This file is retired and regenerated from
// `templates/server/` in Phase 11.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

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
    version: "0.0.0",
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
  },
  async () => {
    return {
      content: [{ type: "text", text: z.literal("noop").parse("noop") }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
