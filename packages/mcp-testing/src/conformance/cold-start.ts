// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Cold-start budget (design.md, Decision 8; mcp-conformance spec,
// "Cold-Start Startup-Cost Budget").
//
// ---------------------------------------------------------------------
// WHY THE CI GATE IS NO LONGER A WALL-CLOCK BUDGET
// ---------------------------------------------------------------------
// `describeConformance` used to assert that the median of 5 cold spawns
// stayed under `COLD_START_BUDGET_MS`. It flaked, and widening 250 ms would
// have buried the reason. Measuring it showed why: on an idle machine the
// median is ~45 ms, but with the machine oversubscribed 8x the same
// unchanged bundle measured a median of 379-592 ms and individual samples
// over 800 ms — and even the FASTEST of 9 samples sometimes exceeded 250 ms.
// Nothing about the bundle changed. An absolute wall-clock bound cannot
// tell "this bundle got slower" from "another vitest worker took the core",
// because wall clock counts the time this process spends not running, and
// under contention that is most of it.
//
// So the gate now measures CPU time instead, which is the time this process
// actually spends executing. Across the same runs, CPU time for the same
// bundle moved from 28.2 ms idle to at worst 38.6 ms at an 8x
// oversubscription — a 1.3x spread where the wall-clock figure moved more
// than 20x. Scheduler delay simply does not appear in it.
//
// Two honest consequences, stated rather than hidden:
//
//   - CPU time is still machine-dependent: a runner with slower cores spends
//     more of it on identical work. Contention was the flakiness, not core
//     speed, so this removes the flake; it does not make the figure
//     universal. The budget of the day kept margin for that and named its
//     own re-measure trigger; the margin was not enough, which is what the
//     next section is about.
//   - A server that answers `initialize` late for a reason that costs no CPU
//     — a network call at startup, a sleep — is no longer caught by this
//     gate. `slow-cold-start-subject.fixture.mjs` measures 0.6 ms of CPU
//     while taking 400 ms of wall clock, which is exactly that case. The
//     conformance suite still fails such a server, because its `beforeAll`
//     awaits a real `initialize`; what is gone is the 250 ms line, which was
//     never measurable on a shared runner anyway.
//
// `COLD_START_BUDGET_MS`, `checkColdStart` and `measureMedianColdStart`
// below are RETAINED as the wall-clock diagnostic and remain unit-tested.
// They are no longer the CI gate.
//
// ---------------------------------------------------------------------
// AND WHY THE CPU GATE IS NO LONGER AN ABSOLUTE BUDGET EITHER
// ---------------------------------------------------------------------
// The CPU budget above replaced a figure that measured contention with one
// that does not. It still measured the machine. The first CI run this
// repository ever executed (GitHub Actions, ubuntu-24.04, Azure) failed on
// it, with the bundle byte-identical to the one that measured 28.2 ms here:
//
//   MCP conformance: packages/fixture-server/dist/server.js
//   > spends at or under 75 ms of CPU starting up (min of 7 samples)
//   min CPU 105.7 ms over budget; samples cpu/wall (ms):
//   113.5/354.1, 112.5/391.7, 117.5/508.6, 111.2/334.9, 105.7/252.6,
//   112.1/301.7, 111.8/288.7
//
// That is the DISCLOSED LIMITATION the budget carried, firing exactly as
// written: "a runner whose cores are more than ~2.5x slower per-core than
// the measuring machine would exceed 75 ms on an unchanged bundle". The
// runner is 3.6x slower per-core. Nothing about the subject changed, so the
// gate reported a property of Azure's hardware and called it a regression.
//
// Raising 75 to something that fits that runner would repeat the mistake
// the 250 ms wall-clock budget made: a number large enough for the slowest
// machine anyone might run it on is a number no realistic regression
// reaches. The disease is the absolute bound itself. `redact.timing.test.ts`
// records the same disease and the same cure, two directories away: an
// absolute bound that was "measuring the machine's memory hierarchy and GC
// and calling it regex complexity" became a RATIO between two measurements
// taken on the same machine in the same run.
//
// So the gate is now `subject CPU / reference CPU`, where the reference is a
// synthetic module measured through the identical harness, interleaved with
// the subject, in the same process tree, on the same machine. A slower
// runner makes both sides slower and the ratio stands still. What the ratio
// asserts is "this bundle is heavy relative to this runtime's own floor" —
// which is the question — rather than "this machine is fast", which was
// never the question. `MAX_STARTUP_CPU_RATIO` below records the reference's
// shape, the measurements, and the arithmetic.
//
// ---------------------------------------------------------------------
// DEVIATION FROM openspec/specs/mcp-conformance/spec.md, recorded here
// rather than silently taken (the precedent is
// `packages/aco/src/mcp.conformance.test.ts`'s own deviation note)
// ---------------------------------------------------------------------
// "Requirement: Cold-Start Time Budget" states the measurement as "from
// `spawn()` of the built entrypoint to the `initialize` response", and its
// two scenarios say "WHEN the suite spawns it and times to the `initialize`
// response". The CI gate below does NOT do that: it times the import in CPU
// milliseconds, and divides by a reference measurement rather than
// comparing to a constant, for the reasons above. Everything else the
// requirement asks for is honoured — a documented CI-blocking threshold,
// recorded with its sample count, its statistic, its safety multiplier and
// its re-derive trigger, and a failure that reports the measurement against
// the threshold. The spec's "Cold-Start Startup-Cost Budget" requirement
// has been updated to state the ratio; this note is kept because the
// deviation from the ORIGINAL wall-clock formulation still stands.
//
// The requirement's "measured on the actual CI runner (not a local
// development machine)" clause was ALREADY unsatisfied before this change —
// see the DISCLOSED LIMITATION on `COLD_START_BUDGET_MS` below, which says
// the 250 ms figure came from a dev machine too. This change does not fix
// that; it inherits it.
//
// Reconciling the spec text with this measurement is a spec decision, not a
// test-file decision, and is deliberately left open.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STARTUP_CPU_HARNESS_PATH = fileURLToPath(new URL("./startup-cpu-harness.mjs", import.meta.url));

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
// ---------------------------------------------------------------------
// VERDICT ON THIS CONSTANT (2026-10-22) — is it now vacuous?
// ---------------------------------------------------------------------
// As a BUDGET, yes: nothing compares a real bundle against it any more.
// `describeConformance` asserts the startup-CPU ratio instead, so 250 ms is
// not applied to any server this repository builds. Its only remaining live
// role is as the line the 400 ms `slow-cold-start-subject.fixture.mjs` must
// exceed in `cold-start.test.ts`, which proves the wall-clock DIAGNOSTIC
// fires but measures no real subject — a calibration, not a measurement.
//
// It is also now known to be wrong, which is the stronger reason not to
// re-arm it. The CI run quoted in this file's header recorded wall-clock
// figures of 252.6-508.6 ms for an unchanged bundle on the real runner. The
// MINIMUM of those seven samples already exceeds 250 ms. Re-arming this
// constant as a gate would fail every CI run on arrival, and widening it to
// fit that runner would restore exactly the 5.9x-headroom uselessness it
// was abandoned for.
//
// It is therefore RETAINED deliberately, and only as: (a) the wall-clock
// diagnostic's own calibration constant, and (b) the evidence, kept next to
// its derivation, of what an absolute bound derived on one machine is worth
// on another. Re-deriving it on the CI runner would not rescue it, because
// a wall-clock figure on a shared runner measures that runner's contention
// — see this file's header. Do not promote it back to a gate; if a
// wall-clock property ever needs gating, it needs the same ratio treatment
// the CPU figure just received, and the spec's own text warns that a
// wall-clock ratio does not duration-match and inflates under load.
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

// ---------------------------------------------------------------------
// STARTUP CPU — the measurement the CI gate is built from
// ---------------------------------------------------------------------
//   Harness:  `startup-cpu-harness.mjs`, one fresh process per sample,
//             `process.cpuUsage()` sampled either side of
//             `await import(<built bundle>)`. Node's own boot is outside the
//             sampled window; what is inside it is the bundle being read,
//             parsed, evaluated, and running its top-level
//             `await server.connect(transport)`.
//
//   Measured (2026-10-20, local development machine, 12 cores):
//     idle, 9 samples x 3 repetitions, all three server bundles:
//       cpu min 28.2-29.9 ms, median 28.7-30.9 ms
//     the same bundles with 96 CPU burners running (load average 230-400):
//       cpu min 30.8-38.6 ms, median 38.5-45.4 ms
//     the same runs' WALL figures, for contrast:
//       idle median 25.3-27.4 ms; contended median 379-592 ms, max 839 ms
//
//   Measured (2026-10-22, GitHub Actions ubuntu-24.04, the real runner,
//   this repository's first CI run):
//     the fixture-server bundle, unchanged: cpu min 105.7 ms. That figure,
//     against the 28.2 ms measured locally for the same bytes, is the 3.6x
//     per-core gap this file's header describes, and the reason the
//     absolute budget derived from the figures above is gone.
//
//   The measurement is kept, unchanged, because it is sound. What is gone
//   is comparing it to a number.

/** One `startup-cpu-harness.mjs` sample. `wallMs` is carried for diagnosis only — nothing asserts on it. */
export interface StartupCpuSample {
  readonly cpuMs: number;
  readonly wallMs: number;
}

/** One fresh process that imports `modulePath` and reports what that cost in CPU time. */
export function measureOneStartupCpu(modulePath: string): Promise<StartupCpuSample> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STARTUP_CPU_HARNESS_PATH, modulePath], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      // The harness emits exactly one marked line; a server bundle may have
      // written its own diagnostics to stderr around it, so search rather
      // than assume a position.
      for (const line of stderr.split("\n")) {
        if (!line.includes('"__startupCpu"')) {
          continue;
        }
        const parsed = JSON.parse(line) as StartupCpuSample;
        resolve({ cpuMs: parsed.cpuMs, wallMs: parsed.wallMs });
        return;
      }
      reject(new Error(`startup-cpu-harness reported nothing for ${modulePath} (exit ${String(code)}); stderr: ${stderr.trim() || "(empty)"}`));
    });
  });
}

/**
 * The MINIMUM CPU sample of `sampleCount`, not the mean or the median.
 * Every source of interference available here — a co-running vitest worker,
 * a GC pause, cache pressure from a loaded machine — can only make a sample
 * cost more, never less, so the minimum is the sample least contaminated by
 * the environment and the closest available estimate of what the bundle
 * costs on its own. It also makes a warm-up discard unnecessary: a cold
 * first sample simply never wins.
 */
export async function measureStartupCpu(
  modulePath: string,
  sampleCount = 7,
): Promise<{ readonly samples: readonly StartupCpuSample[]; readonly minCpuMs: number }> {
  const samples: StartupCpuSample[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    samples.push(await measureOneStartupCpu(modulePath));
  }
  return { samples, minCpuMs: Math.min(...samples.map((sample) => sample.cpuMs)) };
}

// ---------------------------------------------------------------------
// THE REFERENCE MODULE — the ratio's denominator
// ---------------------------------------------------------------------
// WHAT IT IS: a generated module that declares `REFERENCE_UNITS` small
// functions, each closing over a compiled `RegExp`, and then at top level
// calls every one of them and retains the results. That is deliberately the
// shape a bundled MCP server's own startup has: a large body of
// lazily-compiled function declarations (parse and compile cost) wrapped
// around top-level initialisation that builds closures, compiles patterns
// and fills a registry (execution cost). It is generated, not checked in,
// because a 460 KB blob of generated JavaScript in a public repository is
// a liability and the generator is the readable artefact.
//
// WHY NOT SOMETHING SIMPLER — each rejection is measured, 2026-10-22, this
// machine, min of 7 samples through this same harness:
//
//   An EMPTY module costs 0.53 ms. The real bundles cost 24-28 ms, so the
//   ratio would be ~50x and dominated by whatever the ESM loader does
//   before reaching any user code — syscalls and node-internal work that
//   has no reason to scale with a runner's core speed the way compiling
//   and running a megabyte of JavaScript does. All the machine-dependence
//   would stay in the numerator, which is the defect being fixed.
//
//   A PARSE-ONLY module (1 MB of never-called declarations) costs 8.4 ms,
//   against 24.7 ms for a 1.06 MB real bundle. Parse is only about a third
//   of what a server bundle pays; the other two thirds is its top-level
//   initialisation. A denominator missing two thirds of the subject's work
//   is a denominator that moves differently from it.
//
//   The MCP SDK, imported from `node_modules`, was rejected without
//   measuring: it would make the ratio "cost beyond the SDK", which hides
//   an SDK upgrade — the single largest component of every bundle here —
//   and it resolves as hundreds of small files, a cost profile nothing in
//   `dist/` shares. `mcp-core` is also the only package permitted to import
//   it (AGENTS.md).
//
// HOW THE SHAPE WAS CHOSEN: three candidate shapes were measured against
// `fixture-server` and `eds` under four execution regimes — default,
// `--no-opt`, `--jitless` and `--max-semi-space-size=1` — on the reasoning
// that a reference which tracks the subject across radically different
// execution regimes on ONE machine is the best available evidence that it
// tracks it across machines, which is the property that cannot be measured
// here. Spread of the resulting ratio, max/min:
//
//   declarations + a Map of scalar results      1.339x
//   declarations + retained object descriptors  1.267-1.392x
//   closures over compiled RegExps (chosen)     1.152x
//
// The closure/RegExp shape is the one that moves with the subject, and it
// is also the shape with the clearest claim to resemble it: zod schemas and
// tool registrations are closures over compiled patterns.
//
// REFERENCE_UNITS is calibrated so the reference costs about what a current
// bundle costs (462,607 bytes, 29-35 ms here). That is not cosmetic: it
// puts the ratio near 1.0, so `MAX_STARTUP_CPU_RATIO` reads directly as the
// growth factor allowed, and it duration-matches the two sides so neither
// accumulates more interference than the other over a run.
const REFERENCE_UNITS = 2500;

function renderStartupCpuReference(units: number): string {
  const parts = [
    "// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.\n",
    "// GENERATED by @hiberus-magento/mcp-testing (cold-start.ts) as the\n",
    "// denominator of the startup-CPU ratio gate. Not a source file.\n",
  ];
  for (let unit = 0; unit < units; unit += 1) {
    parts.push(`function f${unit}(a) {\n  const re = /^(?:k${unit})[-_](\\w+)$/;\n  return (s) => (re.test(s) ? s.length + a + ${unit} : a);\n}\n`);
  }
  parts.push("const registry = [];\nlet acc = 0;\n");
  for (let unit = 0; unit < units; unit += 1) {
    parts.push(`const g${unit} = f${unit}(${unit});\nregistry.push(g${unit});\nacc += g${unit}("k${unit}_x");\n`);
  }
  // Observable, so the optimiser cannot delete the work being measured.
  parts.push("globalThis.__startupCpuReference = { registered: registry.length, acc };\n");
  return parts.join("");
}

let cachedReferencePath: string | undefined;

/**
 * Path to the generated reference module, written once per process into the
 * OS temp directory. The filename carries a digest of the content, so a
 * change to {@link renderStartupCpuReference} or `REFERENCE_UNITS` can never
 * be measured against a stale file left behind by an earlier run — and two
 * concurrent vitest workers agreeing on the name is why the write goes to a
 * pid-suffixed path first and is then renamed, which is atomic within one
 * filesystem. A torn reference would silently change the denominator.
 */
export function startupCpuReferencePath(): string {
  if (cachedReferencePath !== undefined) {
    return cachedReferencePath;
  }
  const source = renderStartupCpuReference(REFERENCE_UNITS);
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const finalPath = join(tmpdir(), `mcp-startup-cpu-reference-${digest}.mjs`);
  if (!existsSync(finalPath)) {
    const pendingPath = `${finalPath}.${String(process.pid)}.pending`;
    writeFileSync(pendingPath, source);
    renameSync(pendingPath, finalPath);
  }
  cachedReferencePath = finalPath;
  return finalPath;
}

// ---------------------------------------------------------------------
// MAX_STARTUP_CPU_RATIO — the CI gate
// ---------------------------------------------------------------------
//   Statistic: min of 7 subject samples divided by min of 7 reference
//   samples, the two interleaved so a drift in machine conditions lands on
//   both sides. The minimum for the same reason it was the minimum before:
//   interference can only add.
//
//   Measured 2026-10-22, this machine, 4 bundles x 4 execution regimes x 2
//   repetitions (32 ratios), reference as above:
//
//     default                   0.837 - 0.968
//     --no-opt                  0.937 - 1.031
//     --jitless                 0.918 - 0.996
//     --max-semi-space-size=1   0.944 - 1.102
//     overall                   0.837 - 1.102   (1.316x spread)
//
//   Separately, 5 repetitions of all 4 bundles in the default regime while
//   the machine's own load drifted: the absolute figures moved 22.1 -> 26.7
//   ms on the reference and 24.8 -> 33.5 ms on the subjects (1.21x and
//   1.35x), while the ratio stayed within 1.108 - 1.295 (1.17x). That is
//   the ratio absorbing machine drift, measured rather than asserted.
//
//   And through this exact implementation, 5 repetitions x 4 bundles on a
//   quiet machine: 0.793 - 0.888 (1.12x spread), reference min steady at
//   29.1 - 29.7 ms. The default-regime figure across both of those sittings
//   is 0.793 - 0.968.
//
//   Derivation, by the same formula every other threshold in this file
//   uses, applied to the worst figure the statistic ever produced (1.102):
//
//     ceil(1.102 * 1.75) = 1.929  ->  rounded up to the next 0.25  =  2.00
//
//   Headroom: 1.81x over the worst measured ratio, 2.07x over the worst
//   default-regime one. The `--max-semi-space-size=1` regime is kept in the
//   derivation although no runner is configured that way, because it is the
//   regime where the reference diverges most from the subjects (the bundles
//   allocate more at startup than the reference does) and excluding the
//   inconvenient regime is how a threshold becomes a number that only fits
//   the machine it was taken on.
//
// ---------------------------------------------------------------------
// WHAT THIS CATCHES, AND WHAT IT DOES NOT
// ---------------------------------------------------------------------
//   Current bundles sit at 0.79-1.10. Failing needs the subject to cost
//   about 1.8x-2.4x what it costs today, measured against the reference on
//   whatever machine is running.
//
//   CAUGHT: a dependency that does real work while being imported — the
//   `cpu-heavy-startup-subject.fixture.mjs` shape, and the regression that
//   actually happens. Roughly 30 ms of extra startup CPU on this machine
//   trips it; an added dependency that both parses and initialises costs
//   about 35-67 ms per MB, so about 0.5-1 MB of genuinely-initialising code
//   — a doubling of the bundle with its initialisation in proportion.
//
//   NOT CAUGHT: byte growth alone. A megabyte of code that is parsed and
//   never run costs only 8.4 ms here, so inert growth would have to be
//   roughly 4.6x the current bundle before the ratio reached 2.00. This is
//   a property of measuring startup CPU, not of the ratio: the superseded
//   75 ms budget needed about 5.6 MB of the same inert growth, so the gate
//   became more sensitive here, not less. `scripts/compare-bundle-size.mjs`
//   is what watches bytes.
//
//   NOT CAUGHT: a server slow for a reason that costs no CPU — unchanged
//   from the budget this replaces, pinned by a test, see the header.
//
// ---------------------------------------------------------------------
// DISCLOSED LIMITATION
// ---------------------------------------------------------------------
// The ratio has NOT been measured on the CI runner, because this
// environment cannot trigger a GitHub Actions workflow — the same gap every
// threshold in this file has carried. What has changed is that the gap no
// longer has a known failure mode: the one thing that demonstrably broke
// the absolute budget, a runner 3.6x slower per core, divides out. The
// four-regime spread above is the substitute evidence, and it is a
// substitute. Re-derive when: the real CI ratio becomes available and falls
// outside 0.79-1.10, or the reference module's shape changes.
export const MAX_STARTUP_CPU_RATIO = 2;

/** A single startup-CPU ratio breach found by {@link checkStartupCpuRatio}. Extracted for the same reason as {@link checkColdStart}: so the failure path can be exercised directly. */
export interface StartupCpuRatioViolation {
  readonly ratio: number;
  readonly maxRatio: number;
}

/**
 * A violation when the ratio exceeds `maxRatio` — and ALSO when it is not a
 * finite number.
 *
 * The obvious spelling, `ratio > maxRatio`, fails OPEN on a NaN: `NaN > 2`
 * is `false`, so a measurement that never really happened would be reported
 * as a pass. The absolute budget this replaced failed CLOSED in the same
 * situation, because its degenerate value was `Infinity` and `Infinity > 75`
 * is a violation. Making the gate machine-independent must not also flip the
 * direction it fails in: a gate is worth having only for the runs where
 * something has gone wrong, and a measurement that produced no number is one
 * of those runs.
 */
export function checkStartupCpuRatio(ratio: number, maxRatio: number): StartupCpuRatioViolation | undefined {
  return Number.isFinite(ratio) && ratio <= maxRatio ? undefined : { ratio, maxRatio };
}

/** What {@link measureStartupCpuRatio} observed. Both sides' raw samples are carried so a failure can report what it actually saw. */
export interface StartupCpuRatioMeasurement {
  readonly subjectSamples: readonly StartupCpuSample[];
  readonly referenceSamples: readonly StartupCpuSample[];
  readonly subjectCpuMs: number;
  readonly referenceCpuMs: number;
  readonly ratio: number;
}

/**
 * Startup CPU of `modulePath` relative to the reference module, both
 * measured through the same harness in the same run.
 *
 * The two are INTERLEAVED rather than measured in two blocks: a machine
 * that gets busier partway through a run would otherwise load one side of
 * the division and not the other, which is precisely the contamination the
 * ratio exists to cancel.
 */
export async function measureStartupCpuRatio(modulePath: string, sampleCount = 7): Promise<StartupCpuRatioMeasurement> {
  // `Math.min()` of an empty list is `Infinity`, so a count below 1 would
  // divide Infinity by Infinity and hand back a NaN ratio. `checkStartupCpuRatio`
  // treats that as a violation rather than a pass, but a gate failure would
  // send its reader looking for a performance regression that never existed.
  // A measurement that cannot be taken is a caller's mistake, and it says so.
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError(`measureStartupCpuRatio needs a sample count of at least 1, received ${sampleCount}.`);
  }
  const referencePath = startupCpuReferencePath();
  const subjectSamples: StartupCpuSample[] = [];
  const referenceSamples: StartupCpuSample[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    referenceSamples.push(await measureOneStartupCpu(referencePath));
    subjectSamples.push(await measureOneStartupCpu(modulePath));
  }
  const referenceCpuMs = Math.min(...referenceSamples.map((sample) => sample.cpuMs));
  const subjectCpuMs = Math.min(...subjectSamples.map((sample) => sample.cpuMs));
  return { subjectSamples, referenceSamples, subjectCpuMs, referenceCpuMs, ratio: subjectCpuMs / referenceCpuMs };
}

// ---------------------------------------------------------------------
// PER-PACKAGE OVERRIDE — the maximum ratio a package may declare openly
// ---------------------------------------------------------------------
// The default maximum was derived from servers with six to nine tools. A
// server that builds its tool input schemas when its module is evaluated
// spends measurably more CPU doing so: `magento-rest` builds 95 and
// `magento-graphql` up to 247, and that work is the whole difference between
// them and their siblings, not a regression.
//
// Widening the SHARED maximum would loosen the gate for every package, so the
// default stays `MAX_STARTUP_CPU_RATIO` and a package may instead declare its
// own — openly. `startupCpuRatio` takes a number AND a reason, and the reason
// is printed in the test's title, so an exception cannot be quiet. It moves in
// steps of 0.25, the rounding every threshold in this file uses, and it is
// capped at `MAX_STARTUP_CPU_RATIO_OVERRIDE` so it cannot hollow the gate out;
// a stricter maximum than the default is allowed.
//
// A package's figure comes from the same formula as the default, applied to
// its own worst measured ratio: ceil(ratio * 1.75), rounded up to the next
// 0.25. It replaces the per-package millisecond budgets the absolute gate
// carried (100 ms and 150 ms), which failed on the CI runner for the same
// reason the shared 75 ms did.
export const MAX_STARTUP_CPU_RATIO_OVERRIDE = 4;
const MIN_OVERRIDE_REASON_CHARS = 20;

export interface StartupCpuRatioOverride {
  /** The maximum ratio, in steps of 0.25, above 0 and at most {@link MAX_STARTUP_CPU_RATIO_OVERRIDE}. */
  readonly max: number;
  /** Why this package needs its own figure. Printed in the test title. */
  readonly reason: string;
}

export interface ResolvedStartupCpuRatio {
  readonly maxRatio: number;
  readonly reason?: string;
}

export function resolveStartupCpuRatio(override: StartupCpuRatioOverride | undefined): ResolvedStartupCpuRatio {
  if (override === undefined) {
    return { maxRatio: MAX_STARTUP_CPU_RATIO };
  }
  const { max } = override;
  if (!Number.isFinite(max) || max <= 0 || max > MAX_STARTUP_CPU_RATIO_OVERRIDE || !Number.isInteger(max * 4)) {
    throw new Error(`A startup CPU ratio override must be a multiple of 0.25 above 0 and at most ${MAX_STARTUP_CPU_RATIO_OVERRIDE}; got ${max}.`);
  }
  const reason = override.reason.trim();
  if (reason.length < MIN_OVERRIDE_REASON_CHARS) {
    throw new Error(`A startup CPU ratio override needs a reason of at least ${MIN_OVERRIDE_REASON_CHARS} characters saying why this package needs its own figure.`);
  }
  return { maxRatio: max, reason };
}

/** The test's title: the established one for the shared maximum, and one that names the exception otherwise. */
export function startupCpuTestTitle(ratio: ResolvedStartupCpuRatio): string {
  const suffix = ratio.reason !== undefined ? `; package override: ${ratio.reason}` : "";
  return `spends at most ${ratio.maxRatio}x the reference module's CPU starting up (min of 7 samples each${suffix})`;
}
