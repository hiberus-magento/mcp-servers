#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Domain-independent fd-1 contamination probe (design.md, Decision 1). Run
// as `node fd1-probe-harness.mjs <serverPath> <mode>`, this file IS the
// server process the conformance suite's `JsonRpcClient` spawns and drives
// for one extra session — it registers no tool of its own and knows nothing
// about any package's domain.
//
// Two modes:
//   divert        — `await import(serverPath)`; the bundle's own top-level
//                    `await server.connect(transport)` runs to completion
//                    first (installing the stdout guard, if the server calls
//                    `createStdioServer()`), then this harness attempts
//                    three contaminating writes: `console.log`, a raw
//                    string `process.stdout.write`, and a raw Buffer
//                    `process.stdout.write`. If the guard is genuinely
//                    installed, all three land on stderr prefixed
//                    "[stdout-diverted] " and the JSON-RPC session driven
//                    over stdin/stdout stays pure. Used by
//                    `describeConformance` against every real server.
//   inherit-child  — mcp-testing self-test only (never run by
//                    `describeConformance` against a real server): spawns a
//                    grandchild with `stdio: "inherit"`, which writes
//                    directly to this process's inherited fd 1, bypassing
//                    `process.stdout.write` (and therefore any in-process
//                    guard) entirely. This is the permanent positive
//                    control proving fd inheritance is a genuinely
//                    detectable hazard, without ever running a real server.
import { spawnSync } from "node:child_process";

const [, , serverPath, mode] = process.argv;

if (mode === "inherit-child") {
  // `stdio: "inherit"` is the one legitimate use in this repository (see the
  // eslint `no-restricted-syntax` ignore for this exact file) — it is the
  // mechanism under test, not a hazard to close here.
  spawnSync(process.execPath, ["-e", "process.stdout.write('inherit-child-contamination\\n')"], {
    stdio: "inherit",
  });
} else if (mode === "divert") {
  if (!serverPath) {
    throw new Error("fd1-probe-harness.mjs: divert mode requires a serverPath argument");
  }
  // Runs the server's own top-level module code to completion, including its
  // `await server.connect(transport)` — so if the server calls
  // `createStdioServer()`, the stdout guard is already installed by the time
  // control returns here.
  await import(serverPath);
  console.log("[fd1-probe-harness] contamination attempt: console.log");
  process.stdout.write("[fd1-probe-harness] contamination attempt: raw string write\n");
  process.stdout.write(Buffer.from("[fd1-probe-harness] contamination attempt: raw Buffer write\n"));
} else {
  throw new Error(`fd1-probe-harness.mjs: unknown mode "${String(mode)}" — expected "divert" or "inherit-child"`);
}
