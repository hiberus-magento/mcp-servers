// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `mcp-core` implements the stdout guard, and the guard's own unit tests
// prove it works — but nothing called it. Every server this repository
// shipped constructed `new StdioServerTransport()` with no arguments, so the
// real stdout handle stayed public and the guarantee was never installed.
// The conformance suite still caught a stray write, because it DETECTS
// contamination; the guard is what PREVENTS it. Detection is not prevention,
// and this test is what stops the mechanism drifting back into dead code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const SERVER_ENTRYPOINTS = ["templates/server/src/server.ts", "packages/fixture-server/src/server.ts"];

describe.each(SERVER_ENTRYPOINTS)("%s", (relativePath) => {
  const source = readFileSync(join(REPO_ROOT, relativePath), "utf8");

  it("installs the stdout guard before connecting the transport", () => {
    expect(source).toContain("createStdioServer");
  });

  it("hands the transport the guard's private stdout, never the bare global", () => {
    // A bare `new StdioServerTransport()` defaults to `process.stdout`, which
    // is exactly the handle the guard exists to take away from everyone else.
    expect(source).not.toMatch(/new StdioServerTransport\(\s*\)/);
  });
});
