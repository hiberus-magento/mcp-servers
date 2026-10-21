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
import type { RawStdoutLine } from "../jsonrpc-client.js";
import { JsonRpcClient } from "../jsonrpc-client.js";
import {
  checkAnnouncedVersion,
  checkReadOnlyIsolation,
  checkStdoutPurity,
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

describe("checkAnnouncedVersion", () => {
  it("passes when the announced version is the package's own", () => {
    expect(checkAnnouncedVersion("0.1.0", "0.1.0")).toBeUndefined();
  });

  it("fails and names BOTH sides for the hardcoded-constant case this check was written for", () => {
    expect(checkAnnouncedVersion("0.0.0", "0.1.0")).toEqual({ announced: "0.0.0", expected: "0.1.0" });
  });

  it("fails and names both sides for a bundle built before the last version bump", () => {
    expect(checkAnnouncedVersion("0.1.0", "0.2.0")).toEqual({ announced: "0.1.0", expected: "0.2.0" });
  });

  it("fails when the server announced no version at all", () => {
    expect(checkAnnouncedVersion(undefined, "0.1.0")).toEqual({ announced: undefined, expected: "0.1.0" });
  });

  // A prerelease differing only in its tag is still a different build; this
  // is an exact comparison, not a semver-range one.
  it("does not treat a prerelease of the same number as a match", () => {
    expect(checkAnnouncedVersion("0.1.0", "0.1.0-rc.1")).toEqual({ announced: "0.1.0", expected: "0.1.0-rc.1" });
  });

  it("proves the check catches a live subprocess announcing the wrong version", async () => {
    // A raw JSON-RPC server, like the metadata subject above: the real
    // servers are built with the version injected, so the only way to
    // observe this check firing end to end is a subject that lies.
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
      "    if (msg.method === 'initialize') {" +
      "      result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'lying-server', version: '0.0.0' } };" +
      "    }" +
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');" +
      "  }" +
      "});";

    const client = new JsonRpcClient({ command: process.execPath, args: ["-e", script] });
    try {
      const result = (await client.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "conformance-checks-test", version: "0.0.0" },
      })) as { serverInfo?: { version?: string } };

      expect(checkAnnouncedVersion(result.serverInfo?.version, "0.1.0")).toEqual({
        announced: "0.0.0",
        expected: "0.1.0",
      });
    } finally {
      client.close();
    }
  });
});

describe("checkStdoutPurity", () => {
  it("passes when every raw stdout line is JSON-RPC", () => {
    const lines: readonly RawStdoutLine[] = [
      { line: '{"jsonrpc":"2.0","id":1,"result":{}}', isJsonRpc: true, parsed: { jsonrpc: "2.0", id: 1, result: {} } },
    ];

    expect(checkStdoutPurity(lines)).toEqual([]);
  });

  it("flags a non-JSON-RPC raw stdout line", () => {
    const lines: readonly RawStdoutLine[] = [
      { line: '{"jsonrpc":"2.0","id":1,"result":{}}', isJsonRpc: true, parsed: { jsonrpc: "2.0", id: 1, result: {} } },
      { line: "stray console output", isJsonRpc: false },
    ];

    const violations = checkStdoutPurity(lines);

    expect(violations).toEqual([{ line: "stray console output" }]);
  });
});
