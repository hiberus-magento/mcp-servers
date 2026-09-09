// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";

describe("logger", () => {
  it("writes info lines to stderr, never stdout", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      logger.info("hello world");
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("hello world"));
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  it("writes error lines to stderr with an ERROR level marker", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      logger.error("boom");
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("ERROR"));
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("boom"));
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
