#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A hand-rolled, raw JSON-RPC subject — no `defineTool`, no SDK — exposing
// exactly one compliant tool that is deliberately NOT named "read-echo".
// Used only by `shell-out-probe-optional.test.ts` to prove that
// `describeConformance`'s exec-based shell-out probe `it()` is skipped
// entirely when `options.shellOutProbe` is omitted (mcp-conformance spec,
// "Stdout Purity Assertion" — "Supplying a shellOutProbe...MUST be
// OPTIONAL"). Before that guard exists, this subject makes the exec probe's
// default `read-echo` lookup hang forever (no handler for `tools/call`),
// which is the intended RED signal.
//
// Installs the same stdout-diversion mechanism as
// `@hiberus-magento/mcp-core`'s `createStdioServer()` (mirrored inline, not
// imported, since this package does not depend on mcp-core), so the
// domain-independent fd-1 probe passes for this subject too — isolating any
// RED failure to the shell-out probe specifically, not to an unrelated,
// pre-existing guard gap.
const realWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encodingOrCallback, maybeCallback) => {
  const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  process.stderr.write(`[stdout-diverted] ${text}`);
  const callback = typeof encodingOrCallback === "function" ? encodingOrCallback : maybeCallback;
  callback?.();
  return true;
};

process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newlineIndex);
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) {
      continue;
    }
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      respond(message.id, { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "no-shell-tool-subject", version: "0.0.0" } });
    } else if (message.method === "tools/list") {
      respond(message.id, {
        tools: [
          {
            name: "not-read-echo",
            description: "A compliant tool that is not read-echo, proving the shell-out probe is skippable.",
            inputSchema: { type: "object", properties: {} },
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
          },
        ],
      });
    }
    // No `tools/call` handler on purpose: this subject never claims to shell
    // out to anything, so it never needs one.
  }
});

function respond(id, result) {
  realWrite(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}
