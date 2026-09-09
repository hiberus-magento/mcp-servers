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

describe("scheme-prefixed authorization headers", () => {
  // `Authorization: <scheme> <value>` is the shape EDS's alternate header and
  // ACO's IMS bearer both use. The key/value pattern stops its value group at
  // whitespace, so it matched the scheme word and left the credential itself
  // in the clear.
  const secret = "abc123SECRETVALUE456";

  it("redacts a bearer token rather than the word 'Bearer'", () => {
    const output = redact(`Authorization: Bearer ${secret}`);
    expect(output).not.toContain(secret);
  });

  it("redacts a token-scheme credential rather than the word 'token'", () => {
    const output = redact(`Authorization: token ${secret}`);
    expect(output).not.toContain(secret);
  });

  it("still redacts the plain header form", () => {
    expect(redact(`X-Auth-Token: ${secret}`)).not.toContain(secret);
  });

  it("keeps the scheme visible, since the scheme is not the secret", () => {
    const output = redact(`Authorization: Bearer ${secret}`);
    expect(output).toContain("Bearer");
  });
});
