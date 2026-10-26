// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. REST results go through allowlists; a free-form query cannot, so what it returns is cleaned by what
// it MUST NOT contain: values of credential-looking columns, encrypted configuration, binary data.
import { describe, expect, it } from "vitest";
import { REDACTED, sanitizeRows } from "./rows.js";

describe("sanitizeRows", () => {
  it("replaces the value of a column whose name says it is a credential", () => {
    const out = sanitizeRows(["entity_id", "email", "password_hash", "rp_token", "api_key", "secret_value"], [{ entity_id: 1, email: "a@example.test", password_hash: "x", rp_token: "y", api_key: "z", secret_value: "w" }]);
    expect(out[0]).toEqual({ entity_id: 1, email: "a@example.test", password_hash: REDACTED, rp_token: REDACTED, api_key: REDACTED, secret_value: REDACTED });
  });

  it("keeps a NULL credential as NULL, so absence is not turned into a secret", () => {
    expect(sanitizeRows(["password_hash"], [{ password_hash: null }])[0]).toEqual({ password_hash: null });
  });

  it("hides the value of a configuration row whose path says it is a secret", () => {
    const rows = [
      { path: "web/secure/base_url", value: "https://shop.example.test/" },
      { path: "payment/gateway/api_key", value: "abc" },
      { path: "system/smtp/password", value: "abc" },
      { path: "crypt/key", value: "abc" },
      { path: "oauth/consumer/access_token", value: "abc" },
    ];
    const out = sanitizeRows(["path", "value"], rows);
    expect(out.map((r) => r["value"])).toEqual(["https://shop.example.test/", REDACTED, REDACTED, REDACTED, REDACTED]);
  });

  it("renders binary values as a size, not their bytes", () => {
    expect(sanitizeRows(["blob"], [{ blob: Buffer.from("abcd") }])[0]).toEqual({ blob: "[binary, 4 bytes]" });
  });

  it("turns BigInt into a string and cuts very long text", () => {
    const out = sanitizeRows(["n", "text"], [{ n: 12345678901234567890n, text: "x".repeat(5000) }]);
    expect(out[0]?.["n"]).toBe("12345678901234567890");
    expect(String(out[0]?.["text"]).length).toBeLessThan(4200);
    expect(String(out[0]?.["text"])).toContain("truncated");
  });

  it("redacts a credential-shaped value inside ordinary text", () => {
    const out = sanitizeRows(["comment"], [{ comment: "customer wrote password=pw-synthetic and Authorization: Bearer bearer-synthetic in the note" }]);
    expect(String(out[0]?.["comment"])).not.toContain("pw-synthetic");
    expect(String(out[0]?.["comment"])).not.toContain("bearer-synthetic");
  });

  it("does not mutate its input", () => {
    const rows = [{ password_hash: "x" }];
    sanitizeRows(["password_hash"], rows);
    expect(rows[0]).toEqual({ password_hash: "x" });
  });
});
