// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { truncate } from "./truncate.js";

describe("truncate", () => {
  it("returns the input unchanged when it is within the byte limit", () => {
    expect(truncate("hello", 1024)).toBe("hello");
  });

  it("cuts oversized ASCII output and appends the exact marker format", () => {
    const input = "x".repeat(20);
    const result = truncate(input, 10);
    expect(result).toBe(`${"x".repeat(10)}[truncated: 10 of 20 bytes — request page 2]`);
  });

  it("cuts at a UTF-8 character boundary, never mid-sequence", () => {
    // "€" is 3 bytes in UTF-8. 5 of them is 15 bytes; a 7-byte cap can only
    // fit 2 whole characters (6 bytes), never a partial third.
    const input = "€".repeat(5);
    const result = truncate(input, 7);
    expect(result).toContain("€€");
    expect(result).not.toContain("€€€");
    expect(result).not.toContain("�");
  });
});
