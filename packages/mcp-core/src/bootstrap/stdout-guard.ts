// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Structural stdout safety (design.md, Decision 2, mechanism M1). Captures
// the real `process.stdout.write` before any application code can reach it,
// hands it exclusively to a private Writable used only by the JSON-RPC
// transport, then replaces `process.stdout.write` with a forwarder to
// stderr. This closes the "a dependency writes to stdout" hole that eslint
// (M2) cannot catch, because it holds at runtime regardless of which code
// — ours or a bundled dependency's — attempts the write.
import { Writable } from "node:stream";

const DIVERTED_PREFIX = "[stdout-diverted] ";

type StdoutWrite = typeof process.stdout.write;
type WriteCallback = (error?: Error | null) => void;

function toText(chunk: unknown, encoding?: BufferEncoding): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString(encoding ?? "utf8");
  }
  return String(chunk);
}

/**
 * The sole holder of the real stdout write after bootstrap. Only
 * `StdioServerTransport` (via `createStdioServer().stdout`) ever receives an
 * instance of this class.
 */
class RealStdoutWritable extends Writable {
  readonly #realWrite: StdoutWrite;
  readonly #realStream: NodeJS.WriteStream;

  constructor(realWrite: StdoutWrite, realStream: NodeJS.WriteStream) {
    // `decodeStrings: false` preserves string chunks as-is instead of
    // converting them to Buffers, so the real write receives byte-identical
    // input to what the transport wrote (JSON-RPC frames are always UTF-8
    // text) rather than a re-encoded copy.
    super({ decodeStrings: false });
    this.#realWrite = realWrite;
    this.#realStream = realStream;
  }

  override _write(chunk: unknown, encoding: BufferEncoding, callback: WriteCallback): void {
    let wroteOk: boolean;
    try {
      wroteOk = this.#realWrite(chunk as never, encoding);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (wroteOk) {
      callback();
      return;
    }
    // The `once('drain')` fallback from `server/stdio.js:9` — correct
    // backpressure means we only signal completion once the real stream has
    // actually flushed, not merely once we handed it the bytes.
    this.#realStream.once("drain", () => callback());
  }
}

export interface StdioServerBootstrap {
  readonly stdout: Writable;
}

export function createStdioServer(): StdioServerBootstrap {
  const realStream = process.stdout;
  const realWrite = realStream.write.bind(realStream) as StdoutWrite;
  const stdout = new RealStdoutWritable(realWrite, realStream);

  const diverted: StdoutWrite = ((
    chunk: unknown,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    maybeCallback?: WriteCallback,
  ) => {
    const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
    const callback = typeof encodingOrCallback === "function" ? encodingOrCallback : maybeCallback;
    process.stderr.write(`${DIVERTED_PREFIX}${toText(chunk, encoding)}`);
    callback?.();
    return true;
  }) as StdoutWrite;

  process.stdout.write = diverted;

  return { stdout };
}
