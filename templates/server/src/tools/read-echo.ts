// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Example read-only tool: echoes a message back through an allowlisted
// subprocess call. Proves the allowlisted-executor and stdout-safety
// primitives (design.md, Decisions 2 and 4) end-to-end in every package
// scaffolded from `templates/server/`, and is exactly the tool the shared
// conformance suite (`mcp-testing`) calls to prove a shelled-out child
// process can never leak onto this server's own JSON-RPC stdout.
//
// Kept in its own module — not inline in `server.ts` — so the conformance
// suite can safely import `readOnlyAllowlist` for registry introspection
// without triggering `server.ts`'s top-level `server.connect(transport)`
// side effect.
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
