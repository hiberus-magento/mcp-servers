// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Proves M4 (design.md, Decision 2) end-to-end: a tool that shells out via
// the allowlisted executor must never let its child process's stdout reach
// this server's own fd 1. The conformance suite's stdout-purity check
// exercises exactly this tool (mcp-servers-bootstrap, task 9.4).
//
// Kept in its own module — not inline in `server.ts` — so the conformance
// suite can safely import `readOnlyAllowlist` for registry introspection
// (mcp-testing, task 9.1) without triggering `server.ts`'s top-level
// `server.connect(transport)` side effect.
import { CommandAllowlist, defineTool, runAllowlisted, validateArgv, type CommandSpec } from "@hiberus-magento/mcp-core";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const readOnlyAllowlist = new CommandAllowlist();

export const echoSpec = readOnlyAllowlist.register({
  bin: "/bin/echo",
  subcommand: [],
  argsSchema: z.object({ message: z.string().max(200) }),
  buildArgv: (args) => [args.message],
  timeoutMs: 2000,
  maxOutputBytes: 4096,
});

export const readEchoTool = defineTool({
  name: "read-echo",
  description:
    "Echoes a message back through an allowlisted read-only subprocess call, " +
    "proving stdout stays pure JSON-RPC even though a child process is spawned.",
  inputSchema: z.object({ message: z.string().max(200) }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  handler: async (args) => {
    const validated = validateArgv(echoSpec, args);
    if (!validated.ok) {
      throw new McpError(ErrorCode.InvalidParams, validated.error.message);
    }
    // `runAllowlisted` intentionally requires `CommandSpec<never>` — a
    // type-erased placeholder any concrete `CommandSpec<A>` must be
    // explicitly cast to at the call site, since a plain field-position
    // generic (`argsSchema: A`) is not naturally contravariant the way a
    // function parameter is.
    const result = await runAllowlisted(echoSpec as CommandSpec<never>, validated.value);
    return result.stdout.trim();
  },
});
