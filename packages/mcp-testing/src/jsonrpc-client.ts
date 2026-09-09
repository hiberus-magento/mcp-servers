// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A raw newline-framed JSON-RPC client (design.md, Decision 6) — NOT the
// SDK's `Client`. Using the SDK's own client would parse frames away
// exactly where inspecting the raw byte stream IS the test: the conformance
// suite's stdout-purity assertion needs to see every line that arrived on
// stdout, JSON-RPC or not, which a conformant client would silently drop.
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

export interface RawStdoutLine {
  readonly line: string;
  readonly isJsonRpc: boolean;
  readonly parsed?: unknown;
}

export interface JsonRpcClientOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

interface JsonRpcMessage {
  readonly jsonrpc?: string;
  readonly id?: number | string;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: unknown;
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === "object" && value !== null && "jsonrpc" in value;
}

// A sanitized, minimal environment — never `process.env` wholesale, so the
// spawned server cannot observe this test process's own credentials or
// configuration.
function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (process.env.PATH !== undefined) {
    env.PATH = process.env.PATH;
  }
  return env;
}

export class JsonRpcClient {
  readonly rawStdoutLines: RawStdoutLine[] = [];
  readonly stderrChunks: string[] = [];

  readonly #child: ChildProcessByStdio<Writable, Readable, Readable>;
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;
  #stdoutBuffer = "";

  constructor(options: JsonRpcClientOptions) {
    this.#child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env ?? sanitizedEnv(),
    });

    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk: string) => {
      this.#onStdoutData(chunk);
    });

    this.#child.stderr.setEncoding("utf8");
    this.#child.stderr.on("data", (chunk: string) => {
      this.stderrChunks.push(chunk);
    });
  }

  #onStdoutData(chunk: string): void {
    this.#stdoutBuffer += chunk;
    for (;;) {
      const newlineIndex = this.#stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) {
        break;
      }
      const line = this.#stdoutBuffer.slice(0, newlineIndex);
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.#handleLine(line);
      }
    }
  }

  #handleLine(line: string): void {
    let parsed: unknown;
    let isJsonRpc: boolean;
    try {
      parsed = JSON.parse(line);
      isJsonRpc = isJsonRpcMessage(parsed);
    } catch {
      isJsonRpc = false;
    }

    this.rawStdoutLines.push({ line, isJsonRpc, parsed });

    if (isJsonRpc) {
      const message = parsed as JsonRpcMessage;
      if (typeof message.id === "number") {
        const pending = this.#pending.get(message.id);
        if (pending) {
          this.#pending.delete(message.id);
          if (message.error !== undefined) {
            pending.reject(message.error);
          } else {
            pending.resolve(message.result);
          }
        }
      }
    }
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.#nextId;
    this.#nextId += 1;
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#child.stdin.write(payload);
    });
  }

  notify(method: string, params?: unknown): void {
    const payload = `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
    this.#child.stdin.write(payload);
  }

  close(): void {
    this.#child.stdin.end();
    this.#child.kill();
  }
}
