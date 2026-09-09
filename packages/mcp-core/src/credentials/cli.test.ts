// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { parseCredentialCliArgs, runCredentialCli } from "./cli.js";

describe("parseCredentialCliArgs", () => {
  it("rejects --token <value>, pointing the caller at stdin or an environment variable", () => {
    const result = parseCredentialCliArgs(["--token", "some-secret-value"]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/stdin/i);
      expect(result.error.message).toMatch(/environment variable/i);
    }
  });

  it("rejects --token=<value> form too", () => {
    const result = parseCredentialCliArgs(["--token=some-secret-value"]);
    expect(result.ok).toBe(false);
  });

  it("accepts an invocation with no --token flag at all", () => {
    const result = parseCredentialCliArgs([]);
    expect(result.ok).toBe(true);
  });
});

describe("runCredentialCli", () => {
  it("exits non-zero when --token is passed", () => {
    const result = runCredentialCli(["--token", "leak-me"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.message).toMatch(/stdin/i);
  });

  it("exits zero when no --token flag is present", () => {
    const result = runCredentialCli([]);
    expect(result.exitCode).toBe(0);
  });
});
