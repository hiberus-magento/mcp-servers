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

// The driver reports where each column came from (mysql2's `orgName` and `orgTable`), so an alias does not hide it.
describe("sanitizeRows with the columns' origins", () => {
  it("redacts a credential column read under an alias", () => {
    const out = sanitizeRows(["entity_id", "ph"], [{ entity_id: 1, ph: "$2y$10$synthetic" }], [
      { name: "entity_id", table: "customer_entity" },
      { name: "password_hash", table: "customer_entity" },
    ]);
    expect(out[0]).toEqual({ entity_id: 1, ph: REDACTED });
  });

  it("redacts an aliased configuration value whose aliased path is a secret, and keeps an ordinary one", () => {
    const origins = [
      { name: "path", table: "core_config_data" },
      { name: "value", table: "core_config_data" },
    ];
    const out = sanitizeRows(["p", "v"], [{ p: "payment/gateway/api_key", v: "abc" }, { p: "web/secure/base_url", v: "https://shop.example.test/" }], origins);
    expect(out.map((r) => r["v"])).toEqual([REDACTED, "https://shop.example.test/"]);
  });

  it("treats a prefixed configuration table the same way", () => {
    const origins = [
      { name: "path", table: "mg_core_config_data" },
      { name: "value", table: "mg_core_config_data" },
    ];
    const out = sanitizeRows(["path", "v"], [{ path: "system/smtp/password", v: "abc" }], origins);
    expect(out[0]).toEqual({ path: "system/smtp/password", v: REDACTED });
  });

  it("redacts a configuration value when its path is not in the result", () => {
    const out = sanitizeRows(["config_id", "v"], [{ config_id: 7, v: "abc" }], [
      { name: "config_id", table: "core_config_data" },
      { name: "value", table: "core_config_data" },
    ]);
    expect(out[0]).toEqual({ config_id: 7, v: REDACTED });
  });

  it("keeps a NULL configuration value as NULL", () => {
    const out = sanitizeRows(["v"], [{ v: null }], [{ name: "value", table: "core_config_data" }]);
    expect(out[0]).toEqual({ v: null });
  });

  it("keeps ordinary columns as before, including a column named value in another table", () => {
    const out = sanitizeRows(["sku", "value"], [{ sku: "DEMO-1", value: "Red" }], [
      { name: "sku", table: "catalog_product_entity" },
      { name: "value", table: "catalog_product_entity_varchar" },
    ]);
    expect(out[0]).toEqual({ sku: "DEMO-1", value: "Red" });
  });
});
