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

export interface McpTool {
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

/** A single tool-metadata gap found by {@link checkToolMetadataComplete}. */
export interface ToolMetadataViolation {
  readonly toolName: string;
  readonly reason: string;
}

/**
 * Pure check backing the "Tool Metadata Completeness" requirement
 * (mcp-conformance spec): every tool must carry a non-empty description, a
 * schema, and all three MCP annotations. Extracted out of the `it()` block
 * below (mirroring the sibling gate scripts' export pattern, e.g.
 * `scripts/verify-bundle.mjs`) specifically so the failure path — which by
 * construction never fires against a `defineTool()`-built server — can be
 * exercised directly against a hand-built non-compliant subject.
 */
export function checkToolMetadataComplete(tools: readonly McpTool[]): readonly ToolMetadataViolation[] {
  const violations: ToolMetadataViolation[] = [];
  for (const tool of tools) {
    if (!tool.description) {
      violations.push({ toolName: tool.name, reason: "missing description" });
    }
    if (!tool.inputSchema) {
      violations.push({ toolName: tool.name, reason: "missing input schema" });
    }
    if (tool.annotations?.readOnlyHint === undefined) {
      violations.push({ toolName: tool.name, reason: "missing readOnlyHint" });
    }
    if (tool.annotations?.destructiveHint === undefined) {
      violations.push({ toolName: tool.name, reason: "missing destructiveHint" });
    }
    if (tool.annotations?.idempotentHint === undefined) {
      violations.push({ toolName: tool.name, reason: "missing idempotentHint" });
    }
  }
  return violations;
}

/** A single allowlist escape found by {@link checkReadOnlyIsolation}. */
export interface ReadOnlyIsolationViolation {
  readonly toolName: string;
  readonly disallowedCommand: string;
}

/**
 * Pure check backing the "Read-Only Tool Isolation" requirement
 * (mcp-conformance spec): a `readOnlyHint: true` tool's registered command
 * keys must all be inside its declared read allowlist. Extracted for the
 * same reason as {@link checkToolMetadataComplete}.
 */
export function checkReadOnlyIsolation(
  introspection: ReadOnlyIntrospection,
): readonly ReadOnlyIsolationViolation[] {
  return introspection.registeredCommandKeys
    .filter((key) => !introspection.expectedCommandKeys.includes(key))
    .map((key) => ({ toolName: introspection.toolName, disallowedCommand: key }));
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
  /**
   * The tool + arguments used to probe that a tool which shells out keeps
   * stdout pure JSON-RPC even though the child process inherits fd 1.
   * Defaults to `read-echo` / `{ message: "conformance-probe" }`, matching
   * every template-generated server's own tool — override this for a
   * domain package whose read-only probe tool has a different name or
   * argument shape.
   */
  readonly shellOutProbe?: ShellOutProbe;
}

/** See {@link ConformanceOptions.shellOutProbe}. */
export interface ShellOutProbe {
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly expectedResultText: string;
}

const DEFAULT_SHELL_OUT_PROBE: ShellOutProbe = {
  toolName: "read-echo",
  arguments: { message: "conformance-probe" },
  expectedResultText: "conformance-probe",
};

export function describeConformance(options: ConformanceOptions): void {
  const shellOutProbe = options.shellOutProbe ?? DEFAULT_SHELL_OUT_PROBE;
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
      const violations = checkToolMetadataComplete(result.tools);
      expect(
        violations,
        violations.map((v) => `tool "${v.toolName}" is ${v.reason}`).join("; "),
      ).toEqual([]);
    });

    if (options.readOnlyIntrospections) {
      for (const introspection of options.readOnlyIntrospections) {
        it(`read-only tool "${introspection.toolName}" registers only allowlisted read commands`, () => {
          const violations = checkReadOnlyIsolation(introspection);
          expect(
            violations,
            violations
              .map((v) => `"${v.toolName}" registered "${v.disallowedCommand}", outside its declared read allowlist`)
              .join("; "),
          ).toEqual([]);
        });
      }
    }

    it("a tool that shells out keeps stdout pure JSON-RPC despite the child inheriting fd 1", async () => {
      const beforeCount = client.rawStdoutLines.length;
      const result = (await client.request("tools/call", {
        name: shellOutProbe.toolName,
        arguments: shellOutProbe.arguments,
      })) as { content: Array<{ type: string; text: string }> };

      expect(result.content[0]?.text).toBe(shellOutProbe.expectedResultText);
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
