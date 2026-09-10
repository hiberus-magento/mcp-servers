#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Cold-start measurement harness (design.md, Decision 8; mcp-conformance
// spec, "Cold-Start Time Budget"). Builds the target package first, then
// times N cold spawns of its built server entrypoint from `spawn()` to the
// `initialize` response — no warm pool, the process is killed between
// iterations. The first `discardCount` samples are discarded (they measure
// OS page-cache warm-up of a just-written bundle, not cold start) and the
// statistic used on the rest is p95, not mean — cold start is a
// tail-latency property.
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";

export const DEFAULT_SAMPLE_COUNT = 20;
export const DEFAULT_DISCARD_COUNT = 3;

/** Spawns `serverPath` cold, sends `initialize`, and resolves with the elapsed milliseconds once the response arrives. Kills the child immediately after — no warm pool, ever. */
export function measureOneColdStart(serverPath) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let settled = false;

    function finish(outcome) {
      if (settled) {
        return;
      }
      settled = true;
      child.stdout.removeAllListeners("data");
      child.removeAllListeners("exit");
      child.removeAllListeners("error");
      child.kill();
      if (outcome.ok) {
        resolve(outcome.ms);
      } else {
        reject(outcome.error);
      }
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) {
          continue;
        }
        try {
          const message = JSON.parse(line);
          if (message.id === 1 && message.result !== undefined) {
            finish({ ok: true, ms: performance.now() - start });
            return;
          }
        } catch {
          // A non-JSON-RPC stray line is not this measurement's concern
          // (that is `mcp-conformance`'s stdout-purity assertion's job).
        }
      }
    });
    child.on("error", (error) => finish({ ok: false, error }));
    child.on("exit", (code) => {
      finish({ ok: false, error: new Error(`server exited (code ${code}) before responding to initialize`) });
    });

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "cold-start-measure", version: "0.0.0" } },
      })}\n`,
    );
  });
}

/** Nearest-rank percentile over a copy of `samples` (does not mutate the input). */
export function percentile(samples, p) {
  if (samples.length === 0) {
    throw new Error("percentile() called on an empty sample set");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

/**
 * @param {string} serverPath
 * @param {{ sampleCount?: number, discardCount?: number }} [options]
 */
export async function measureColdStart(serverPath, options = {}) {
  const sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;
  const discardCount = options.discardCount ?? DEFAULT_DISCARD_COUNT;
  if (discardCount >= sampleCount) {
    throw new Error(`discardCount (${discardCount}) must be less than sampleCount (${sampleCount})`);
  }

  const all = [];
  for (let i = 0; i < sampleCount; i += 1) {
    all.push(await measureOneColdStart(serverPath));
  }
  const discarded = all.slice(0, discardCount);
  const retained = all.slice(discardCount);
  return {
    all,
    discarded,
    retained,
    p50: percentile(retained, 50),
    p95: percentile(retained, 95),
  };
}

async function main() {
  const [packageDir, relativeServerPath] = process.argv.slice(2);
  if (!packageDir || !relativeServerPath) {
    console.error("Usage: node scripts/measure-cold-start.mjs <packageDir> <relativeServerPathFromPackageDir>");
    console.error("Example: node scripts/measure-cold-start.mjs packages/eds dist/mcp.js");
    process.exitCode = 1;
    return;
  }

  console.error(`measure-cold-start: building ${packageDir} ...`);
  execFileSync("pnpm", ["run", "build"], { cwd: packageDir, stdio: "inherit" });

  const serverPath = join(packageDir, relativeServerPath);
  console.error(`measure-cold-start: running ${DEFAULT_SAMPLE_COUNT} cold spawns of ${serverPath}, discarding the first ${DEFAULT_DISCARD_COUNT} ...`);
  const result = await measureColdStart(serverPath);

  console.error(
    `measure-cold-start: N=${result.all.length}, discarded=${result.discarded.length}, retained=${result.retained.length}\n` +
      `  all samples (ms):      ${result.all.map((ms) => ms.toFixed(1)).join(", ")}\n` +
      `  retained p50 (ms):     ${result.p50.toFixed(1)}\n` +
      `  retained p95 (ms):     ${result.p95.toFixed(1)}`,
  );
  console.log(JSON.stringify({ serverPath, ...result }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
