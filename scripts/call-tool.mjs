#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// One-shot stdio MCP client, for smoke-testing a BUILT server by hand.
//
// The test suites in this repository reach a server either through mocked
// `execFile` (fast, but proves nothing about the wire) or through the shared
// conformance suite (real, but fixed in what it asks). Neither lets a human
// ask one built server one question — "does this tool actually work against
// my machine's real CLI, right now" — which is the question that found the
// TSV-parser defects the mocked suites could not see. This script is that
// one question: spawn the bundle, `initialize`, send exactly one
// `tools/call`, print what came back, and exit non-zero if the tool reported
// an error.
//
//   node scripts/call-tool.mjs <server-dist-path> <toolName> '<json-args>'
//   node scripts/call-tool.mjs <server-dist-path> --list
//
// e.g.
//   node scripts/call-tool.mjs packages/magento-cloud/dist/mcp.js --list
//   node scripts/call-tool.mjs packages/magento-cloud/dist/mcp.js \
//     magentocloud_auth_status '{}'
//
// DEVELOPER HARNESS, NOT SHIPPED CODE. It lives at the repo root, which no
// package's `files` array can reach (`call-tool.test.mjs` asserts that, with
// a positive control), and the root package is `private`. It is also
// deliberately dependency-free — it speaks newline-delimited JSON-RPC over
// the child's stdio directly rather than importing the MCP SDK, so it can be
// pointed at a bundle built from any revision without a matching install.
//
// stdout carries the JSON payload and nothing else; everything narrative
// goes to stderr, so `node scripts/call-tool.mjs … | jq` works.
import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_INFO = { name: "call-tool", version: "0.0.0" };

const USAGE = [
  "Usage: node scripts/call-tool.mjs <server-dist-path> <toolName> '<json-args>'",
  "       node scripts/call-tool.mjs <server-dist-path> --list",
  "",
  "Example: node scripts/call-tool.mjs packages/magento-cloud/dist/mcp.js --list",
].join("\n");

export class UsageError extends Error {
  constructor(detail) {
    super(`${detail}\n\n${USAGE}`);
    this.name = "UsageError";
  }
}

/**
 * @param {readonly string[]} argv `process.argv.slice(2)`
 * @returns {{ mode: "list", serverPath: string }
 *   | { mode: "call", serverPath: string, toolName: string, toolArgs: Record<string, unknown> }}
 */
export function parseCallToolArgs(argv) {
  const [serverPath, toolName, rawArgs] = argv;
  if (!serverPath) {
    throw new UsageError("No server path was given.");
  }
  if (toolName === "--list") {
    return { mode: "list", serverPath };
  }
  if (!toolName) {
    throw new UsageError("No tool name was given, and --list was not requested.");
  }

  // An omitted argument object means `{}` — a tool that takes no arguments
  // should not need `'{}'` typed out every time.
  if (rawArgs === undefined) {
    return { mode: "call", serverPath, toolName, toolArgs: {} };
  }

  let toolArgs;
  try {
    toolArgs = JSON.parse(rawArgs);
  } catch (error) {
    // The offending text is echoed back because the usual cause is shell
    // quoting eating the JSON, and a bare "Unexpected token" says nothing
    // about which characters actually arrived.
    throw new UsageError(`Could not parse the tool arguments as JSON: ${rawArgs}\n  (${error.message})`);
  }
  if (toolArgs === null || typeof toolArgs !== "object" || Array.isArray(toolArgs)) {
    throw new UsageError(`Tool arguments must be a JSON object, since a tool call takes named arguments: ${rawArgs}`);
  }
  return { mode: "call", serverPath, toolName, toolArgs };
}

/**
 * A tool that reports `isError` has failed even though the JSON-RPC call
 * succeeded, so the process must not exit 0 on it — that distinction is the
 * whole reason a harness is more useful than `echo | node server.js`.
 */
export function exitCodeForToolResult(result) {
  return result?.isError === true ? 1 : 0;
}

/** Spawns `serverPath` and speaks newline-delimited JSON-RPC to it. */
function openServer(serverPath) {
  const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  const stderrChunks = [];
  let buffer = "";
  let nextId = 0;
  let closed = false;

  function failAllPending(error) {
    closed = true;
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  }

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.length === 0) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        // Not our business to enforce (mcp-conformance owns stdout purity),
        // but worth SAYING: a stray stdout write is exactly the kind of
        // defect someone reaches for this harness to chase.
        process.stderr.write(`call-tool: ignoring a non-JSON line on the server's stdout: ${line}\n`);
        continue;
      }
      const entry = pending.get(message.id);
      if (entry === undefined) {
        continue;
      }
      pending.delete(message.id);
      if (message.error !== undefined) {
        entry.reject(new Error(`server returned a JSON-RPC error: ${JSON.stringify(message.error)}`));
      } else {
        entry.resolve(message.result);
      }
    }
  });

  child.on("error", (error) => failAllPending(error));
  child.on("exit", (code, signal) => {
    const stderrText = stderrChunks.join("").trim();
    failAllPending(
      new Error(
        `server exited (code ${code}, signal ${signal}) before answering` +
          (stderrText.length > 0 ? `\n--- server stderr ---\n${stderrText}` : ""),
      ),
    );
  });

  return {
    request(method, params) {
      if (closed) {
        return Promise.reject(new Error(`cannot send "${method}": the server is no longer running`));
      }
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    close() {
      closed = true;
      pending.clear();
      child.stdin.end();
      child.kill();
    },
  };
}

/** Runs one request against a freshly spawned server and always kills it. */
async function withServer(serverPath, run) {
  const server = openServer(serverPath);
  try {
    await server.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
    server.notify("notifications/initialized");
    return await run(server);
  } finally {
    server.close();
  }
}

/** Every tool the server declares, with its description and annotations. */
export async function listTools(serverPath) {
  const result = await withServer(serverPath, (server) => server.request("tools/list"));
  return (result?.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    annotations: tool.annotations,
  }));
}

/** One `tools/call`. Rejects on a JSON-RPC error rather than inventing a result. */
export async function callTool({ serverPath, toolName, toolArgs }) {
  return withServer(serverPath, (server) => server.request("tools/call", { name: toolName, arguments: toolArgs }));
}

async function main() {
  let parsed;
  try {
    parsed = parseCallToolArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    if (parsed.mode === "list") {
      process.stderr.write(`call-tool: listing tools declared by ${parsed.serverPath} ...\n`);
      const tools = await listTools(parsed.serverPath);
      process.stdout.write(`${JSON.stringify(tools, null, 2)}\n`);
      return;
    }

    process.stderr.write(`call-tool: calling ${parsed.toolName} on ${parsed.serverPath} ...\n`);
    const result = await callTool(parsed);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = exitCodeForToolResult(result);
    if (process.exitCode !== 0) {
      process.stderr.write(`call-tool: ${parsed.toolName} reported isError: true\n`);
    }
  } catch (error) {
    process.stderr.write(`call-tool: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
