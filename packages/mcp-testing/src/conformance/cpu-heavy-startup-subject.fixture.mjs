// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// POSITIVE CONTROL for the startup-CPU budget. Burns CPU at module top
// level — the exact shape of the regression the budget exists to catch: a
// dependency that does real work while it is being imported, so every
// server start pays for it.
//
// It must be CPU, not a timer: `slow-cold-start-subject.fixture.mjs` sleeps,
// and sleeping costs no CPU at all, so it would sail under this budget
// while blowing a wall-clock one. The two controls guard different
// properties and neither replaces the other.
//
// Calibrated to roughly an order of magnitude over `STARTUP_CPU_BUDGET_MS`
// on the machine `cold-start.ts` records its measurements from — decisive
// without making the suite wait. The work is deliberately opaque to the
// optimiser (the result is observable below) so it cannot be eliminated.
const ROUNDS = 60_000_000;

let accumulator = 0;
for (let i = 0; i < ROUNDS; i += 1) {
  accumulator = (accumulator ^ Math.imul(i ^ (accumulator >>> 7), 2654435761)) >>> 0;
}

// Keeps the loop alive against dead-code elimination, and makes the subject
// a well-formed JSON-RPC responder besides, so it can stand in for a server
// anywhere this directory's harnesses expect one.
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line) {
      continue;
    }
    const message = JSON.parse(line);
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { accumulator } })}\n`);
  }
});
