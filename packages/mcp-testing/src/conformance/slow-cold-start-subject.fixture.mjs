// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Deliberately-slow raw JSON-RPC subject for `cold-start.test.ts` (tasks.md
// 12.5): sleeps well past any realistic cold-start budget BEFORE wiring up
// its stdin listener, so its `initialize` response is guaranteed late. Never
// run by `describeConformance` itself — only by the cold-start assertion's
// own regression-guard test, proving the assertion actually fires.
const ARTIFICIAL_DELAY_MS = 400;

setTimeout(() => {
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
      let result = {};
      if (message.method === "tools/list") {
        result = { tools: [] };
      }
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
    }
  });
}, ARTIFICIAL_DELAY_MS);
