// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test closing two sdd-verify CRITICAL findings: `conformance.ts`'s
// "Tool Metadata Completeness" and "Read-Only Tool Isolation" assertions
// (mcp-conformance spec) had never actually been driven into a failing
// state, because `describeConformance()` is only ever run against a server
// built with `defineTool()`, whose compile-time guarantee makes it
// structurally incapable of violating either check.
//
// This file proves the suite's REAL check functions — `checkToolMetadataComplete`
// and `checkReadOnlyIsolation`, extracted verbatim out of `conformance.ts`'s
// own `it()` blocks (same export pattern as `scripts/verify-bundle.mjs`) —
// actually fire when given a violating subject. For the metadata check, the
// subject is a hand-rolled raw JSON-RPC subprocess (no `defineTool`, no SDK)
// whose `tools/list` response is deliberately incomplete, driven through the
// exact same `JsonRpcClient` the real suite uses.
import { afterEach, describe, expect, it } from "vitest";
import { JsonRpcClient } from "../jsonrpc-client.js";
import {
  checkReadOnlyIsolation,
  checkToolMetadataComplete,
  type McpTool,
  type ReadOnlyIntrospection,
} from "./conformance.js";

describe("checkToolMetadataComplete", () => {
  it("passes for a tool with a description, schema, and all three annotations", () => {
    const tools: readonly McpTool[] = [
      {
        name: "complete-tool",
        description: "Does a complete thing.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
    ];

    expect(checkToolMetadataComplete(tools)).toEqual([]);
  });

  it("fails and names the offending tool and missing annotation for a tool missing idempotentHint", () => {
    const tools: readonly McpTool[] = [
      {
        name: "broken-tool",
        description: "Missing one annotation.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
    ];

    const violations = checkToolMetadataComplete(tools);

    expect(violations).toEqual([{ toolName: "broken-tool", reason: "missing idempotentHint" }]);
  });

  it("fails and names every gap for a tool missing description, schema, and all annotations", () => {
    const tools: readonly McpTool[] = [{ name: "empty-tool" }];

    const violations = checkToolMetadataComplete(tools);

    expect(violations).toEqual([
      { toolName: "empty-tool", reason: "missing description" },
      { toolName: "empty-tool", reason: "missing input schema" },
      { toolName: "empty-tool", reason: "missing readOnlyHint" },
      { toolName: "empty-tool", reason: "missing destructiveHint" },
      { toolName: "empty-tool", reason: "missing idempotentHint" },
    ]);
  });

  it("proves the suite's real check catches a live subprocess that violates it — a raw, non-defineTool subject", async () => {
    // `defineTool()`'s compile-time enforcement makes it impossible to
    // construct a violating tool through the normal server-building path —
    // so this subject is a hand-rolled raw JSON-RPC server, exactly the
    // class of subject the verify-report identified as missing.
    const script =
      "process.stdin.setEncoding('utf8');" +
      "let buf='';" +
      "process.stdin.on('data', (chunk) => {" +
      "  buf += chunk;" +
      "  let index;" +
      "  while ((index = buf.indexOf('\\n')) >= 0) {" +
      "    const line = buf.slice(0, index); buf = buf.slice(index + 1);" +
      "    if (!line) continue;" +
      "    const msg = JSON.parse(line);" +
      "    let result = {};" +
      "    if (msg.method === 'tools/list') {" +
      "      result = { tools: [{ name: 'noncompliant-tool', description: 'x', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true, destructiveHint: false } }] };" +
      "    }" +
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');" +
      "  }" +
      "});";

    const client = new JsonRpcClient({ command: process.execPath, args: ["-e", script] });
    try {
      await client.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "conformance-checks-test", version: "0.0.0" },
      });
      const result = (await client.request("tools/list")) as { tools: readonly McpTool[] };

      const violations = checkToolMetadataComplete(result.tools);

      expect(violations).toEqual([{ toolName: "noncompliant-tool", reason: "missing idempotentHint" }]);
    } finally {
      client.close();
    }
  });
});

describe("checkReadOnlyIsolation", () => {
  let client: JsonRpcClient | undefined;

  afterEach(() => {
    client?.close();
    client = undefined;
  });

  it("passes when every registered command key is inside the declared allowlist", () => {
    const introspection: ReadOnlyIntrospection = {
      toolName: "read-echo",
      registeredCommandKeys: ["/bin/echo"],
      expectedCommandKeys: ["/bin/echo"],
    };

    expect(checkReadOnlyIsolation(introspection)).toEqual([]);
  });

  it("fails and identifies the disallowed command when a read-only tool escapes its allowlist", () => {
    // Simulates a `readOnlyHint: true` tool whose allowlist registration
    // reaches outside its declared read-only command set (e.g. a tool that
    // should only run `/bin/echo` but also registered `/bin/rm`).
    const introspection: ReadOnlyIntrospection = {
      toolName: "read-echo",
      registeredCommandKeys: ["/bin/echo", "/bin/rm"],
      expectedCommandKeys: ["/bin/echo"],
    };

    const violations = checkReadOnlyIsolation(introspection);

    expect(violations).toEqual([{ toolName: "read-echo", disallowedCommand: "/bin/rm" }]);
  });
});
