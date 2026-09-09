// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test closing the sdd-verify CRITICAL finding: `readTokenFromStdin`
// (mcp-core spec, "Credential Loading Precedence and Storage" / "Token
// accepted via stdin") was exported and used but never called by any test.
// This file drives the real stream event handlers `readTokenFromStdin`
// attaches to `process.stdin` — swapping in a real `PassThrough` duplex
// stream (same `setEncoding`/`on('data'|'end'|'error')` surface as the real
// stdin) rather than reimplementing the read loop — and proves the scenario
// end to end: a token piped via stdin is accepted and persisted without ever
// appearing in the process argument list.
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCredentialCliArgs, readTokenFromStdin } from "./cli.js";
import { persistCredential, resolveCredentialValue } from "./resolve.js";

const ENV_VAR = "TEST_STDIN_DOMAIN_TOKEN";
const DOMAIN = "example-domain";

describe("readTokenFromStdin", () => {
  let originalStdin: typeof process.stdin;
  let fakeStdin: PassThrough;

  beforeEach(() => {
    originalStdin = process.stdin;
    fakeStdin = new PassThrough();
    Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
  });

  it("resolves the trimmed token once the piped stream ends", async () => {
    const pending = readTokenFromStdin();

    fakeStdin.write("a-real-token-value\n");
    fakeStdin.end();

    await expect(pending).resolves.toBe("a-real-token-value");
  });

  it("trims surrounding whitespace from a multi-chunk pipe", async () => {
    const pending = readTokenFromStdin();

    fakeStdin.write("  split-");
    fakeStdin.write("across-chunks  \n");
    fakeStdin.end();

    await expect(pending).resolves.toBe("split-across-chunks");
  });

  it("resolves an empty string when stdin ends with no data piped at all", async () => {
    const pending = readTokenFromStdin();

    fakeStdin.end();

    await expect(pending).resolves.toBe("");
  });

  it("rejects when the underlying stdin stream errors", async () => {
    const pending = readTokenFromStdin();

    fakeStdin.emit("error", new Error("EPIPE"));

    await expect(pending).rejects.toThrow("EPIPE");
  });

  it("accepts and persists a stdin-piped token without it ever appearing in the process argument list (mcp-core spec scenario)", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "mcp-core-stdin-credentials-"));
    try {
      const secretToken = "stdin-only-secret-9f3a";

      // The CLI parser never had a --token flag to begin with — confirms the
      // "never a command-line argument" half of the rule for this exact
      // invocation's argv.
      const cliResult = parseCredentialCliArgs(process.argv.slice(2));
      expect(cliResult.ok).toBe(true);
      expect(process.argv.join(" ")).not.toContain(secretToken);

      const pending = readTokenFromStdin();
      fakeStdin.write(`${secretToken}\n`);
      fakeStdin.end();
      const tokenFromStdin = await pending;

      persistCredential(DOMAIN, tokenFromStdin, configDir);
      const persisted = resolveCredentialValue({ domain: DOMAIN, envVar: ENV_VAR, configDir });

      expect(persisted).toBe(secretToken);
      expect(process.argv.join(" ")).not.toContain(secretToken);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
