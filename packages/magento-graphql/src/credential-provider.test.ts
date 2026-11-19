// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. No token is "anonymous"; a broken credential file is an error, never "anonymous".
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYNTHETIC_MAGENTO_CUSTOMER_TOKEN } from "@hiberus-magento/mcp-testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAGENTO_GRAPHQL_DOMAIN, TOKEN_ENV_VAR, resolveOptionalCustomerToken } from "./credential-provider.js";

describe("resolveOptionalCustomerToken", () => {
  let dir: string;
  let saved: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "magento-graphql-cred-"));
    saved = process.env[TOKEN_ENV_VAR];
    delete process.env[TOKEN_ENV_VAR];
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) delete process.env[TOKEN_ENV_VAR];
    else process.env[TOKEN_ENV_VAR] = saved;
  });

  it("is undefined (anonymous) when there is neither a variable nor a file", () => {
    expect(resolveOptionalCustomerToken(dir)).toBeUndefined();
  });

  it("reads the environment variable", () => {
    process.env[TOKEN_ENV_VAR] = SYNTHETIC_MAGENTO_CUSTOMER_TOKEN;
    expect(resolveOptionalCustomerToken(dir)).toBe(SYNTHETIC_MAGENTO_CUSTOMER_TOKEN);
  });

  it("reads a 0600 credential file, and picks up a replacement without a restart", () => {
    const file = join(dir, `${MAGENTO_GRAPHQL_DOMAIN}.json`);
    writeFileSync(file, JSON.stringify({ token: SYNTHETIC_MAGENTO_CUSTOMER_TOKEN }), { mode: 0o600 });
    expect(resolveOptionalCustomerToken(dir)).toBe(SYNTHETIC_MAGENTO_CUSTOMER_TOKEN);
    writeFileSync(file, JSON.stringify({ token: "mg-other-token" }), { mode: 0o600 });
    expect(resolveOptionalCustomerToken(dir)).toBe("mg-other-token");
  });

  it("does NOT downgrade a credential file with loose permissions to anonymous", () => {
    const file = join(dir, `${MAGENTO_GRAPHQL_DOMAIN}.json`);
    writeFileSync(file, JSON.stringify({ token: SYNTHETIC_MAGENTO_CUSTOMER_TOKEN }), { mode: 0o600 });
    chmodSync(file, 0o644);
    expect(() => resolveOptionalCustomerToken(dir)).toThrow(/permissions/);
  });
});
