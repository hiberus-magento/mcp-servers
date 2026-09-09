// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it, vi } from "vitest";
import { createStdioServer } from "./stdout-guard.js";

describe("createStdioServer", () => {
  it("diverts process.stdout.write to stderr, prefixed [stdout-diverted], after bootstrap", () => {
    const originalWrite = process.stdout.write;
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      createStdioServer();
      process.stdout.write("rogue line\n");
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("[stdout-diverted] rogue line"));
    } finally {
      process.stdout.write = originalWrite;
      stderrSpy.mockRestore();
    }
  });

  it("gives only the returned private Writable access to the real stdout write", () => {
    const originalWrite = process.stdout.write;
    const realWriteCalls: unknown[] = [];
    process.stdout.write = ((chunk: unknown) => {
      realWriteCalls.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      const { stdout } = createStdioServer();
      stdout.write("protocol frame\n");
      expect(realWriteCalls).toContain("protocol frame\n");

      // Application code writing to process.stdout after bootstrap never
      // reaches the real write again — only the private Writable does.
      realWriteCalls.length = 0;
      process.stdout.write("app code line\n");
      expect(realWriteCalls).toHaveLength(0);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
