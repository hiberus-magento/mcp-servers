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
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTUP_CPU_BUDGET_MS, checkStartupCpu, measureStartupCpu } from "./cold-start.js";
import type { RawStdoutLine } from "../jsonrpc-client.js";
import { JsonRpcClient } from "../jsonrpc-client.js";

const FD1_PROBE_HARNESS_PATH = fileURLToPath(new URL("./fd1-probe-harness.mjs", import.meta.url));

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

/** A single non-JSON-RPC raw stdout line found by {@link checkStdoutPurity}. */
export interface StdoutPurityViolation {
  readonly line: string;
}

/**
 * Pure check backing the "Stdout Purity Assertion" requirement
 * (mcp-conformance spec): nothing but JSON-RPC frames may ever reach the
 * server's stdout stream. Extracted for the same reason as
 * {@link checkToolMetadataComplete} — so the failure path can be exercised
 * directly against a hand-built contaminating subject, not only relied on
 * to never fire against a compliant server.
 */
export function checkStdoutPurity(lines: readonly RawStdoutLine[]): readonly StdoutPurityViolation[] {
  return lines.filter((entry) => !entry.isJsonRpc).map((entry) => ({ line: entry.line }));
}

/** Counts contamination-attempt markers seen so far on either raw stdout
 * (guard NOT installed — the harness's own writes leaked through) or stderr
 * (guard installed — the harness's writes were diverted, as intended). Used
 * only to know when the harness's fixed three attempts have all landed
 * somewhere observable, so {@link runFd1DivertProbe} does not wait longer
 * than necessary. */
function countContaminationSignals(client: JsonRpcClient): number {
  const stdoutHits = client.rawStdoutLines.filter((entry) => entry.line.includes("contamination attempt:")).length;
  const stderrHits = (client.stderrChunks.join("").match(/contamination attempt:/g) ?? []).length;
  return stdoutHits + stderrHits;
}

async function waitForContaminationAttempts(client: JsonRpcClient, expected = 3, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (countContaminationSignals(client) < expected) {
    if (Date.now() - start > timeoutMs) {
      // Best-effort: whatever violations exist by now are what the caller
      // will see — a genuine guard-installed server never times out here.
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * The domain-independent fd-1 contamination probe (design.md, Decision 1;
 * mcp-conformance spec, "Stdout Purity Assertion"). Spawns
 * `fd1-probe-harness.mjs <serverPath> divert` as a SECOND, independent
 * `JsonRpcClient` session — independent of any tool the package under test
 * defines and of whether it supplies a `shellOutProbe` — and reports
 * whichever of the harness's own three contamination attempts reached this
 * session's stdout instead of being diverted to stderr.
 */
export async function runFd1DivertProbe(options: {
  readonly serverPath: string;
}): Promise<readonly StdoutPurityViolation[]> {
  const client = new JsonRpcClient({
    command: process.execPath,
    args: [FD1_PROBE_HARNESS_PATH, options.serverPath, "divert"],
  });
  try {
    await waitForContaminationAttempts(client);
    return checkStdoutPurity(client.rawStdoutLines);
  } finally {
    client.close();
  }
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

/**
 * The shell-out probe matching every template-generated server's own
 * `read-echo` tool. NOT applied as a default inside {@link describeConformance}
 * — `shellOutProbe` is genuinely optional (mcp-conformance spec, "Stdout
 * Purity Assertion"), so a caller that wants this exact coverage (e.g. the
 * `fixture-server` conformance suite) supplies it explicitly.
 */
export const DEFAULT_SHELL_OUT_PROBE: ShellOutProbe = {
  toolName: "read-echo",
  arguments: { message: "conformance-probe" },
  expectedResultText: "conformance-probe",
};

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
      const violations = checkStdoutPurity(client.rawStdoutLines);
      expect(
        violations,
        violations.map((v) => `stray stdout line: ${JSON.stringify(v.line)}`).join("; "),
      ).toEqual([]);
    });

    // Mandatory and independent of `shellOutProbe`: every package under test
    // is exercised for stdout purity via fd inheritance, even one with no
    // `execFile`-based tool of its own (mcp-conformance spec, "Stdout Purity
    // Assertion" — "Domain-independent probe catches contamination with no
    // shellOutProbe supplied").
    it("keeps stdout pure via the domain-independent fd-1 probe, independent of shellOutProbe", async () => {
      const violations = await runFd1DivertProbe({ serverPath: options.serverPath });
      expect(
        violations,
        violations.map((v) => `stray stdout line: ${JSON.stringify(v.line)}`).join("; "),
      ).toEqual([]);
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

    // Supplying `shellOutProbe` is OPTIONAL (mcp-conformance spec, "Stdout
    // Purity Assertion"): a package with no `execFile`-based tool must not
    // be forced to ship a decorative one just to exercise this suite. When
    // supplied, it runs exactly as it always has, unweakened.
    if (options.shellOutProbe) {
      const configuredShellOutProbe = options.shellOutProbe;
      it("a tool that shells out keeps stdout pure JSON-RPC despite the child inheriting fd 1", async () => {
        const beforeCount = client.rawStdoutLines.length;
        const result = (await client.request("tools/call", {
          name: configuredShellOutProbe.toolName,
          arguments: configuredShellOutProbe.arguments,
        })) as { content: Array<{ type: string; text: string }> };

        expect(result.content[0]?.text).toBe(configuredShellOutProbe.expectedResultText);
        const newLines = client.rawStdoutLines.slice(beforeCount);
        const nonJsonRpc = newLines.filter((entry) => !entry.isJsonRpc);
        expect(nonJsonRpc).toEqual([]);
      });
    }

    // This gate asserts WHAT `verify-bundle.mjs` finds, never how long it
    // takes to find it: it shells out to `npm pack`, `tar` and a 1 MB
    // bundle read, which cost ~0.7 s idle and were measured at 5.1-5.2 s on
    // a contended machine — just over vitest's 5 s default, which then
    // failed the run with a timeout that was asserting nothing. The explicit
    // bound below is generous on purpose; it exists to catch a hang, not to
    // time the packer. Startup cost is asserted by the next test, on a
    // quantity that contention does not move.
    it("passes the packaging gate (G1-G6: single bundle, size, forbidden deps, tarball shape)", () => {
      expect(() =>
        execFileSync(process.execPath, ["../../scripts/verify-bundle.mjs"], {
          cwd: options.packageDir,
          stdio: "pipe",
        }),
      ).not.toThrow();
    }, 120_000);

    // Startup cost (mcp-conformance spec, "Cold-Start Time Budget";
    // design.md, Decision 8), measured in CPU time rather than wall clock —
    // `cold-start.ts`'s header records why the wall-clock median was
    // replaced, and what that assertion no longer covers. Each sample is its
    // own fresh process importing the SAME built entrypoint; the statistic
    // is the minimum, because interference can only add.
    it(`spends at or under ${STARTUP_CPU_BUDGET_MS} ms of CPU starting up (min of 7 samples)`, async () => {
      const { samples, minCpuMs } = await measureStartupCpu(options.serverPath);
      const violation = checkStartupCpu(minCpuMs, STARTUP_CPU_BUDGET_MS);
      expect(
        violation,
        `min CPU ${minCpuMs.toFixed(1)} ms over budget; samples cpu/wall (ms): ${samples
          .map((sample) => `${sample.cpuMs.toFixed(1)}/${sample.wallMs.toFixed(1)}`)
          .join(", ")}`,
      ).toBeUndefined();
    }, 60_000);
  });
}
