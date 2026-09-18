// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Unit coverage for `call-tool.mjs`'s pure argument parsing and exit-code
// decision, plus real-process integration against `fixture-server`'s own
// already-built bundle (read-only) — the same subject, and the same
// `describe.skipIf(!existsSync(...))` guard, `measure-cold-start.test.mjs`
// uses, so a checkout that has not built yet still runs green.
//
// The integration half matters more than it looks: the whole point of this
// harness is to talk to a REAL server over a REAL stdio pipe, so a test that
// mocked the transport would prove nothing about the thing it exists to do.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { callTool, exitCodeForToolResult, listTools, parseCallToolArgs } from "./call-tool.mjs";

describe("parseCallToolArgs", () => {
  it("parses a call: server path, tool name, and JSON arguments", () => {
    const parsed = parseCallToolArgs(["dist/mcp.js", "read-echo", '{"message":"hello"}']);

    expect(parsed).toEqual({
      mode: "call",
      serverPath: "dist/mcp.js",
      toolName: "read-echo",
      toolArgs: { message: "hello" },
    });
  });

  it("defaults the arguments to {} when a no-argument tool is called", () => {
    expect(parseCallToolArgs(["dist/mcp.js", "noop"])).toEqual({
      mode: "call",
      serverPath: "dist/mcp.js",
      toolName: "noop",
      toolArgs: {},
    });
  });

  it("parses --list into list mode, with no tool name", () => {
    expect(parseCallToolArgs(["dist/mcp.js", "--list"])).toEqual({ mode: "list", serverPath: "dist/mcp.js" });
  });

  it("throws a usage error when no server path is given", () => {
    expect(() => parseCallToolArgs([])).toThrow(/Usage/);
  });

  it("throws a usage error when neither a tool name nor --list is given", () => {
    expect(() => parseCallToolArgs(["dist/mcp.js"])).toThrow(/Usage/);
  });

  it("names the offending text when the JSON arguments do not parse", () => {
    expect(() => parseCallToolArgs(["dist/mcp.js", "read-echo", "{not json}"])).toThrow(/{not json}/);
  });

  it("rejects JSON arguments that are not an object — a tool call takes named arguments", () => {
    expect(() => parseCallToolArgs(["dist/mcp.js", "read-echo", "[1,2,3]"])).toThrow(/object/);
  });
});

describe("exitCodeForToolResult", () => {
  it("is 1 when the tool reported isError", () => {
    expect(exitCodeForToolResult({ isError: true, content: [{ type: "text", text: "boom" }] })).toBe(1);
  });

  it("is 0 when the tool did not report isError", () => {
    expect(exitCodeForToolResult({ content: [{ type: "text", text: "fine" }] })).toBe(0);
  });

  it("is 0 for an explicit isError: false", () => {
    expect(exitCodeForToolResult({ isError: false, content: [] })).toBe(0);
  });
});

// This is a developer harness, not shipped code. No package may publish it.
describe("packaging: call-tool.mjs is not publishable from any package", () => {
  const packagesDir = fileURLToPath(new URL("../packages/", import.meta.url));

  it("no package's files array reaches the repo-root scripts directory", () => {
    const offenders = [];
    for (const name of readdirSync(packagesDir)) {
      const manifestPath = `${packagesDir}${name}/package.json`;
      if (!existsSync(manifestPath)) {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      for (const entry of manifest.files ?? []) {
        if (entry.includes("..") || entry.includes("scripts")) {
          offenders.push(`${name}: ${entry}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  // POSITIVE CONTROL: the same filter DOES catch a files entry that could
  // reach this script, so an empty offender list above is evidence rather
  // than a filter that never matches anything.
  it("positive control: the same filter catches a files entry that would reach scripts/", () => {
    const offenders = ["dist", "../../scripts/call-tool.mjs", "LICENSE"].filter(
      (entry) => entry.includes("..") || entry.includes("scripts"),
    );

    expect(offenders).toEqual(["../../scripts/call-tool.mjs"]);
  });
});

const FIXTURE_SERVER_BUNDLE = fileURLToPath(new URL("../packages/fixture-server/dist/server.js", import.meta.url));

describe.skipIf(!existsSync(FIXTURE_SERVER_BUNDLE))("real-process integration against the fixture-server bundle", () => {
  it("lists the server's tools with their annotations", async () => {
    const tools = await listTools(FIXTURE_SERVER_BUNDLE);

    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(Object.keys(byName).sort()).toEqual(["noop", "read-echo"]);
    expect(byName["read-echo"].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  }, 30_000);

  it("calls a tool and returns the server's own result content", async () => {
    const result = await callTool({
      serverPath: FIXTURE_SERVER_BUNDLE,
      toolName: "read-echo",
      toolArgs: { message: "acme-demo-echo" },
    });

    expect(exitCodeForToolResult(result)).toBe(0);
    expect(JSON.stringify(result)).toContain("acme-demo-echo");
  }, 30_000);

  // VERIFIED AGAINST A REAL SERVER, not assumed: the MCP SDK does NOT turn a
  // rejected tool call into a JSON-RPC error. It answers with an ordinary
  // result carrying `isError: true` and the failure text — which is exactly
  // why this harness must key its exit code off `isError` rather than off
  // whether the request resolved.
  it("surfaces an argument-validation failure as an isError result worth exiting 1 on", async () => {
    const result = await callTool({
      serverPath: FIXTURE_SERVER_BUNDLE,
      toolName: "read-echo",
      // The tool's own schema caps `message` at 200 characters.
      toolArgs: { message: "x".repeat(201) },
    });

    expect(result.isError).toBe(true);
    expect(exitCodeForToolResult(result)).toBe(1);
  }, 30_000);

  it("surfaces an unknown tool name as an isError result, never as a silent success", async () => {
    const result = await callTool({ serverPath: FIXTURE_SERVER_BUNDLE, toolName: "no-such-tool", toolArgs: {} });

    expect(result.isError).toBe(true);
    expect(exitCodeForToolResult(result)).toBe(1);
  }, 30_000);

  it("rejects, carrying the child's stderr, when the server cannot start at all", async () => {
    await expect(
      callTool({ serverPath: `${FIXTURE_SERVER_BUNDLE}.does-not-exist`, toolName: "noop", toolArgs: {} }),
    ).rejects.toThrow(/server exited/);
  }, 30_000);
});
