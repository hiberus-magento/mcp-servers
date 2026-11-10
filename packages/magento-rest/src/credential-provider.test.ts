// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MissingCredentialError } from "@hiberus-magento/mcp-core";
import { SYNTHETIC_MAGENTO_TOKEN } from "@hiberus-magento/mcp-testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAGENTO_REST_DOMAIN, TOKEN_ENV_VAR, createMagentoTokenProvider } from "./credential-provider.js";

describe("createMagentoTokenProvider", () => {
  let configDir: string;
  let saved: string | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "magento-rest-"));
    saved = process.env[TOKEN_ENV_VAR];
    delete process.env[TOKEN_ENV_VAR];
  });
  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    if (saved === undefined) {
      delete process.env[TOKEN_ENV_VAR];
    } else {
      process.env[TOKEN_ENV_VAR] = saved;
    }
  });

  it("names its domain and env var as the manifest declares them", () => {
    expect(MAGENTO_REST_DOMAIN).toBe("magento-rest");
    expect(TOKEN_ENV_VAR).toBe("MAGENTO_REST_TOKEN");
  });

  it("reads the token from the environment", async () => {
    process.env[TOKEN_ENV_VAR] = SYNTHETIC_MAGENTO_TOKEN;
    const credential = await createMagentoTokenProvider(configDir).getToken();
    expect(credential).toEqual({ kind: "static", value: SYNTHETIC_MAGENTO_TOKEN });
  });

  it("reads it from the 0600 credential file when the variable is unset", async () => {
    writeFileSync(join(configDir, "magento-rest.json"), JSON.stringify({ token: SYNTHETIC_MAGENTO_TOKEN }), { mode: 0o600 });
    expect((await createMagentoTokenProvider(configDir).getToken()).value).toBe(SYNTHETIC_MAGENTO_TOKEN);
  });

  it("surfaces a loose-permission credential file as itself, not as a missing credential", async () => {
    writeFileSync(join(configDir, "magento-rest.json"), JSON.stringify({ token: SYNTHETIC_MAGENTO_TOKEN }), { mode: 0o644 });
    const error = await createMagentoTokenProvider(configDir)
      .getToken()
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(MissingCredentialError);
    expect((error as Error).message).toMatch(/group\/world permissions/);
  });

  it("picks up a token added while the process is running — nothing is cached", async () => {
    const provider = createMagentoTokenProvider(configDir);
    await expect(provider.getToken()).rejects.toBeInstanceOf(MissingCredentialError);
    process.env[TOKEN_ENV_VAR] = SYNTHETIC_MAGENTO_TOKEN;
    expect((await provider.getToken()).value).toBe(SYNTHETIC_MAGENTO_TOKEN);
  });

  it("refuses with an actionable message naming the CLI command, the variable and the file", async () => {
    const error = await createMagentoTokenProvider(configDir)
      .getToken()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MissingCredentialError);
    const message = (error as Error).message;
    expect(message).toContain("hiberus-magento-rest auth token set");
    expect(message).toContain("MAGENTO_REST_TOKEN");
    expect(message).toContain("magento-rest.json");
  });
});
