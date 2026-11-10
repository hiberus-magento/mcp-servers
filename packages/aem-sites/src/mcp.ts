#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// aem-sites — an MCP server for the AEM as a Cloud Service Sites author,
// scaffolded from `templates/server/`. Imports ONLY the stdio transport deep
// paths from the SDK — never the package barrel and never
// `server/index.js` directly — so the bundle stays clean of express/hono/ajv.
//
// Thin on purpose, like `eds`'s: the tools live in `./tools/aem-tools.ts`,
// and this file registers them and connects the transport UNCONDITIONALLY
// at module top level, which the shared fd-1 conformance probe relies on.
//
// A configuration that is SET but malformed (a bad AEM_AUTHORS origin, a
// write root under /apps, an operator in AEM_EXTRA_PROPERTIES) stops the
// server at startup: it is never discovered halfway through a plan. An
// UNSET AEM_AUTHORS does not: tools/list keeps working and each call names
// the missing variable.
import { createStdioServer, logger, serverVersion } from "@hiberus-magento/mcp-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { parseConfig } from "./config.js";
import { createAemTools, createRuntimeResolver, redactResult } from "./tools/aem-tools.js";

const noElicitationValidator = {
  getValidator() {
    return () => {
      throw new McpError(ErrorCode.InvalidRequest, "elicitation is not supported by stdio servers");
    };
  },
};

if ((process.env.AEM_AUTHORS ?? "") !== "") {
  try {
    parseConfig(process.env);
  } catch (error) {
    logger.error(`hiberus-aem-sites-mcp: invalid configuration — ${(error as Error).message}`);
    process.exit(1);
  }
}

const server = new McpServer({ name: "aem-sites", version: serverVersion() }, { jsonSchemaValidator: noElicitationValidator });

const getRuntime = createRuntimeResolver();

for (const tool of createAemTools({ getRuntime })) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema.shape, annotations: tool.annotations },
    async (args: unknown, extra) => {
      const progressToken = extra._meta?.progressToken;
      const reportProgress =
        progressToken === undefined
          ? undefined
          : (progress: number, total: number | undefined, message: string) =>
              extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress, ...(total !== undefined ? { total } : {}), message } });
      const result = redactResult(await tool.invoke(args, { signal: extra.signal, ...(reportProgress !== undefined ? { reportProgress } : {}) }));
      return { content: [...result.content], isError: result.isError };
    },
  );
}

const { stdout } = createStdioServer();
const transport = new StdioServerTransport(process.stdin, stdout);
await server.connect(transport);
