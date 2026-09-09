// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { redact } from "./redact.js";

describe("redact", () => {
  it("masks a key/value secret pair", () => {
    const result = redact("token=abc123secret");
    expect(result).not.toContain("abc123secret");
    expect(result).toContain("token=");
  });

  it("masks the userinfo portion of a credentialed URL, leaving the password absent", () => {
    const result = redact("connecting to https://user:hunter2@example.test/api now");
    expect(result).not.toContain("hunter2");
    expect(result).toContain("https://***:***@example.test/api");
  });

  it("masks a key: value pair with a colon separator too", () => {
    const result = redact("password: sup3r-secret-value");
    expect(result).not.toContain("sup3r-secret-value");
    expect(result).toContain("password:");
  });

  it("leaves ordinary text with no secrets untouched", () => {
    const line = "the catalog import finished with 12 rows";
    expect(redact(line)).toBe(line);
  });
});
