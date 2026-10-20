#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Measures the CPU time a module spends being loaded and initialised.
// Run as `node startup-cpu-harness.mjs <modulePath>`; this file IS the
// process under measurement, exactly as `fd1-probe-harness.mjs` is, and it
// knows nothing about any package's domain.
//
// `process.cpuUsage()` is sampled either side of the import, so the figure
// is the module's own cost: node's boot is excluded (it happens before the
// first sample), and so is everything the scheduler does to this process
// while it is NOT running, which is the entire point — see `cold-start.ts`.
//
// The result goes to STDERR. A server bundle takes fd 1 away as part of
// starting up (`createStdioServer()`), and fd 1 is the JSON-RPC transport
// besides; stderr is the only stream this harness may use.
import { pathToFileURL } from "node:url";

const [, , modulePath] = process.argv;
if (!modulePath) {
  throw new Error("startup-cpu-harness.mjs: a module path argument is required");
}

const cpuBefore = process.cpuUsage();
const wallBefore = performance.now();
await import(pathToFileURL(modulePath).href);
const cpu = process.cpuUsage(cpuBefore);
const wallMs = performance.now() - wallBefore;

process.stderr.write(
  `${JSON.stringify({
    __startupCpu: true,
    cpuMs: (cpu.user + cpu.system) / 1000,
    userMs: cpu.user / 1000,
    systemMs: cpu.system / 1000,
    wallMs,
  })}\n`,
);

// The imported server has connected a stdio transport, which keeps the event
// loop alive forever. The measurement is taken; leave.
process.exit(0);
