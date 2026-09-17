// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Cold-start budget (design.md, Decision 8; mcp-conformance spec,
// "Cold-Start Time Budget").
import { spawn } from "node:child_process";

// ---------------------------------------------------------------------
// METHODOLOGY AND RAW NUMBERS (recorded here, not only as a bare number)
// ---------------------------------------------------------------------
//   Harness: `scripts/measure-cold-start.mjs` (root, plain script) —
//     N = 20 cold `spawn(process.execPath, [builtEntrypoint])` iterations,
//     NO warm pool, timed from `spawn()` to the `initialize` JSON-RPC
//     response, the child killed immediately after each iteration. The
//     first 3 samples are discarded (they measure OS page-cache warm-up of
//     a just-written bundle, not cold start) and the statistic used on the
//     remaining 17 is p95, not mean — cold start is a tail-latency
//     property, and a shared runner's tail is what breaks builds.
//
//   Local sanity-check run (subject: packages/eds/dist/mcp.js, this batch):
//     date:              2026-09-10
//     runner:            local development machine (NOT CI — see the
//                        disclosed limitation below)
//     N / discarded:     20 / 3 (17 retained)
//     local p50 (ms):    45.0
//     local p95 (ms):    46.6
//     all 20 raw samples were within 44.1-46.6 ms — a tight, low-variance
//     read, consistent with a warm local SSD and no contention.
//
//   CI-runner run (ubuntu-latest, workflow_dispatch): NOT PERFORMED.
//
// ---------------------------------------------------------------------
// DISCLOSED LIMITATION — not an invented number
// ---------------------------------------------------------------------
// design.md, Decision 8 requires the THRESHOLD to come from a real CI
// runner via a `workflow_dispatch` job, explicitly never a dev machine,
// because a shared runner's tail latency is what actually breaks builds;
// the local figure is meant to be a sanity check only. This environment has
// no ability to trigger or execute a GitHub Actions workflow, so the
// CI-runner measurement design.md requires could not be produced. Rather
// than invent a number, `COLD_START_BUDGET_MS` below is computed from the
// LOCAL measurement using the exact same formula design.md specifies
// (`ceil(p95 * 1.75)`, rounded up to the next 250 ms), applied honestly as
// the best available evidence, and is explicitly marked PROVISIONAL:
//
//   ceil(46.6 * 1.75) = 82  ->  rounded up to the next 250 ms  =  250
//
// This threshold MUST be re-measured on the real CI runner
// (`node scripts/measure-cold-start.mjs packages/eds dist/mcp.js` inside a
// `workflow_dispatch` job) before it can be trusted as the production-grade
// figure this spec requires. Re-measure trigger: real CI numbers become
// available, OR the bundle's byte size moves more than 20%.
export const COLD_START_BUDGET_MS = 250;

// ---------------------------------------------------------------------
// RE-MEASURE TRIGGER CHECK — aco-package (tasks.md, Phase 7)
// ---------------------------------------------------------------------
//   date:              2026-09-17
//   command:           node scripts/compare-bundle-size.mjs
//                        packages/aco/dist/mcp.js packages/eds/dist/mcp.js
//   aco/dist/mcp.js:   1,106,603 bytes
//   eds/dist/mcp.js:   1,085,024 bytes (the reference this constant was
//                      derived against, see the measurement above)
//   ratio:             +2.0%
//
// |ratio| <= 20%, so design.md's own re-measure trigger does NOT fire for
// `aco`. `COLD_START_BUDGET_MS` above is EXPLICITLY RETAINED at 250 ms for
// `aco` — not because 250 ms is redundantly re-derived from `aco`'s own
// bundle, but because a package whose bundle size is this close to the one
// the constant was measured against gives no evidence that the existing
// figure is wrong. Raising or lowering it here with no supporting
// measurement would be an invented number, and this constant is shared by
// every package `describeConformance` covers (`eds` included) — moving it
// for `aco` alone is not even representable without the additive
// `coldStartBudgetMs` override (`ConformanceOptions`), which this batch
// does NOT add, precisely because the trigger that would justify it did
// not fire. `aco`'s own `describeConformance` cold-start assertion
// therefore runs against this exact same constant, unmodified, and passed
// (see `packages/aco/src/mcp.conformance.test.ts`).

/** One cold spawn of `serverPath`, timed from `spawn()` to the `initialize` response. The child is killed immediately after. No warm pool. */
export function measureOneColdStart(serverPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let settled = false;

    function finish(outcome: { ok: true; ms: number } | { ok: false; error: Error }): void {
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
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) {
          continue;
        }
        try {
          const message = JSON.parse(line) as { id?: number; result?: unknown };
          if (message.id === 1 && message.result !== undefined) {
            finish({ ok: true, ms: performance.now() - start });
            return;
          }
        } catch {
          // A non-JSON-RPC stray line is not this measurement's concern.
        }
      }
    });
    child.on("error", (error) => finish({ ok: false, error }));
    child.on("exit", (code) => {
      finish({ ok: false, error: new Error(`server exited (code ${String(code)}) before responding to initialize`) });
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

/** A single cold-start budget breach found by {@link checkColdStart}. Extracted for the same reason as `checkStdoutPurity`/`checkToolMetadataComplete`: so the failure path can be exercised directly, not only relied on to never fire. */
export interface ColdStartViolation {
  readonly medianMs: number;
  readonly budgetMs: number;
}

export function checkColdStart(medianMs: number, budgetMs: number): ColdStartViolation | undefined {
  return medianMs > budgetMs ? { medianMs, budgetMs } : undefined;
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

/**
 * The assertion's own sample size (design.md, Decision 8): M = 5 cold
 * spawns, compared by MEDIAN against `COLD_START_BUDGET_MS`. Median-of-5
 * trades sensitivity for stability — a single scheduler hiccup cannot fail
 * CI, and a genuine regression moves the median.
 */
export async function measureMedianColdStart(serverPath: string, sampleCount = 5): Promise<{ readonly samples: readonly number[]; readonly medianMs: number }> {
  const samples: number[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    samples.push(await measureOneColdStart(serverPath));
  }
  return { samples, medianMs: median(samples) };
}
