// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { afterEach, describe, expect, it } from "vitest";
import { JsonRpcClient } from "./jsonrpc-client.js";

// Every case spawns a tiny inline Node script rather than the real MCP
// server — this file proves the raw-stream client's framing and
// purity-detection behavior in isolation, independent of any protocol
// detail. `conformance.test.ts` exercises it against the real built bundle.
describe("JsonRpcClient", () => {
  let client: JsonRpcClient | undefined;

  afterEach(() => {
    client?.close();
    client = undefined;
  });

  it("parses a newline-framed JSON-RPC response and resolves the matching pending request by id", async () => {
    const script =
      "process.stdin.setEncoding('utf8');" +
      "let buf='';" +
      "process.stdin.on('data', (chunk) => {" +
      "  buf += chunk;" +
      "  let index;" +
      "  while ((index = buf.indexOf('\\n')) >= 0) {" +
      "    const line = buf.slice(0, index); buf = buf.slice(index + 1);" +
      "    if (!line) continue;" +
      "    const msg = JSON.parse(line);" +
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { echoed: msg.method } }) + '\\n');" +
      "  }" +
      "});";
    client = new JsonRpcClient({ command: process.execPath, args: ["-e", script] });

    const result = await client.request("ping");

    expect(result).toEqual({ echoed: "ping" });
  });

  it("flags a stray non-JSON-RPC stdout line without dropping it", async () => {
    const script =
      "process.stdout.write('a stray debug line\\n');" +
      "process.stdin.setEncoding('utf8');" +
      "let buf='';" +
      "process.stdin.on('data', (chunk) => {" +
      "  buf += chunk;" +
      "  let index;" +
      "  while ((index = buf.indexOf('\\n')) >= 0) {" +
      "    const line = buf.slice(0, index); buf = buf.slice(index + 1);" +
      "    if (!line) continue;" +
      "    const msg = JSON.parse(line);" +
      "    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: 'ok' }) + '\\n');" +
      "  }" +
      "});";
    client = new JsonRpcClient({ command: process.execPath, args: ["-e", script] });

    await client.request("ping");

    const strayLines = client.rawStdoutLines.filter((entry) => !entry.isJsonRpc);
    expect(strayLines).toHaveLength(1);
    expect(strayLines[0]?.line).toBe("a stray debug line");
  });

  it("captures stderr separately from the JSON-RPC stdout stream", async () => {
    const script = "process.stderr.write('diagnostic output\\n');";
    client = new JsonRpcClient({ command: process.execPath, args: ["-e", script] });

    // Poll rather than sleeping a fixed interval: spawning the child and
    // draining its stderr can take longer than any fixed guess on a loaded
    // CI machine, and this suite blocks CI. Polling passes as soon as the
    // output arrives and only spends the full budget when it never does.
    await expect
      .poll(() => client?.stderrChunks.join("") ?? "", { timeout: 10_000, interval: 10 })
      .toContain("diagnostic output");
  });
});
