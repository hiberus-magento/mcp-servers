// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `describeConformance()` — a vitest suite factory every server package
// must pass (design.md, Decision 6; mcp-conformance spec). Spawns the BUILT
// bundle (`node dist/server.js`) as a subprocess with `stdio:
// ['pipe','pipe','pipe']` and a sanitized environment, driving it with the
// raw newline-framed `JsonRpcClient` — never the SDK's own `Client`, which
// would parse frames away exactly where inspecting the raw stream IS the
// test.
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsonRpcClient } from "../jsonrpc-client.js";

interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
  };
}

interface ToolsListResult {
  readonly tools: readonly McpTool[];
}

/** Minimal shape shared with `mcp-core`'s `CommandAllowlist` — this module
 * never imports mcp-core to avoid coupling the suite to its internals;
 * callers pass the exact command keys their allowlist actually registers. */
export interface ReadOnlyIntrospection {
  readonly toolName: string;
  readonly registeredCommandKeys: readonly string[];
  readonly expectedCommandKeys: readonly string[];
}

export interface ConformanceOptions {
  /** Path to the built entrypoint, e.g. `.../dist/server.js`. */
  readonly serverPath: string;
  /** Directory containing the package's `package.json`, for the packaging-gate step. */
  readonly packageDir: string;
  readonly readOnlyIntrospections?: readonly ReadOnlyIntrospection[];
}

export function describeConformance(options: ConformanceOptions): void {
  describe(`MCP conformance: ${options.serverPath}`, () => {
    let client: JsonRpcClient;

    beforeAll(async () => {
      client = new JsonRpcClient({ command: process.execPath, args: [options.serverPath] });
      await client.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-testing-conformance", version: "0.0.0" },
      });
      client.notify("notifications/initialized");
    });

    afterAll(() => {
      client.close();
    });

    it("responds to tools/list with a well-formed tool list", async () => {
      const result = (await client.request("tools/list")) as ToolsListResult;
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBeGreaterThan(0);
    });

    it("emits nothing but JSON-RPC frames on stdout across the whole session", async () => {
      const nonJsonRpc = client.rawStdoutLines.filter((entry) => !entry.isJsonRpc);
      expect(nonJsonRpc).toEqual([]);
    });

    it("every tool has a non-empty description, a schema, and all three annotations", async () => {
      const result = (await client.request("tools/list")) as ToolsListResult;
      for (const tool of result.tools) {
        expect(tool.description, `tool "${tool.name}" is missing a description`).toBeTruthy();
        expect(tool.inputSchema, `tool "${tool.name}" is missing an input schema`).toBeTruthy();
        expect(tool.annotations?.readOnlyHint, `tool "${tool.name}" is missing readOnlyHint`).toBeDefined();
        expect(tool.annotations?.destructiveHint, `tool "${tool.name}" is missing destructiveHint`).toBeDefined();
        expect(tool.annotations?.idempotentHint, `tool "${tool.name}" is missing idempotentHint`).toBeDefined();
      }
    });

    if (options.readOnlyIntrospections) {
      for (const introspection of options.readOnlyIntrospections) {
        it(`read-only tool "${introspection.toolName}" registers only allowlisted read commands`, () => {
          for (const key of introspection.registeredCommandKeys) {
            expect(
              introspection.expectedCommandKeys,
              `"${introspection.toolName}" registered "${key}", outside its declared read allowlist`,
            ).toContain(key);
          }
        });
      }
    }

    it("a tool that shells out keeps stdout pure JSON-RPC despite the child inheriting fd 1", async () => {
      const beforeCount = client.rawStdoutLines.length;
      const result = (await client.request("tools/call", {
        name: "read-echo",
        arguments: { message: "conformance-probe" },
      })) as { content: Array<{ type: string; text: string }> };

      expect(result.content[0]?.text).toBe("conformance-probe");
      const newLines = client.rawStdoutLines.slice(beforeCount);
      const nonJsonRpc = newLines.filter((entry) => !entry.isJsonRpc);
      expect(nonJsonRpc).toEqual([]);
    });

    it("passes the packaging gate (G1-G6: single bundle, size, forbidden deps, tarball shape)", () => {
      expect(() =>
        execFileSync(process.execPath, ["../../scripts/verify-bundle.mjs"], {
          cwd: options.packageDir,
          stdio: "pipe",
        }),
      ).not.toThrow();
    });
  });
}
