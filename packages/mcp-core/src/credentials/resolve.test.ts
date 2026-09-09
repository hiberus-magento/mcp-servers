// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { credentialFilePath, persistCredential, resolveCredentialValue } from "./resolve.js";
import { MissingCredentialError } from "./token-provider.js";

const ENV_VAR = "TEST_DOMAIN_TOKEN";
const DOMAIN = "example-domain";

describe("resolveCredentialValue", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "mcp-core-credentials-"));
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env[ENV_VAR];
  });

  it("returns the environment variable's value when both env and config file supply a value", () => {
    process.env[ENV_VAR] = "from-env";
    writeFileSync(join(configDir, `${DOMAIN}.json`), JSON.stringify({ token: "from-config" }), { mode: 0o600 });

    const value = resolveCredentialValue({ domain: DOMAIN, envVar: ENV_VAR, configDir });

    expect(value).toBe("from-env");
  });

  it("falls back to the config file when the environment variable is unset", () => {
    writeFileSync(join(configDir, `${DOMAIN}.json`), JSON.stringify({ token: "from-config" }), { mode: 0o600 });

    const value = resolveCredentialValue({ domain: DOMAIN, envVar: ENV_VAR, configDir });

    expect(value).toBe("from-config");
  });

  it("throws MissingCredentialError when neither source has a value — no third branch, never prompts", () => {
    expect(() => resolveCredentialValue({ domain: DOMAIN, envVar: ENV_VAR, configDir })).toThrow(
      MissingCredentialError,
    );
  });

  it("refuses a loose-permission config file rather than reading it", () => {
    const filePath = join(configDir, `${DOMAIN}.json`);
    writeFileSync(filePath, JSON.stringify({ token: "from-config" }), { mode: 0o644 });

    expect(() => resolveCredentialValue({ domain: DOMAIN, envVar: ENV_VAR, configDir })).toThrow(/permissions/i);
  });
});

describe("persistCredential", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = join(mkdtempSync(join(tmpdir(), "mcp-core-credentials-")), "hiberus");
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("writes the credential file at mode 0600 inside a 0700 directory", () => {
    const filePath = persistCredential(DOMAIN, "a-real-token-value", configDir);

    const dirStat = statSync(configDir);
    const fileStat = statSync(filePath);
    expect(dirStat.mode & 0o777).toBe(0o700);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  it("persists a token that resolveCredentialValue can then read back", () => {
    persistCredential(DOMAIN, "round-trip-token", configDir);

    const value = resolveCredentialValue({ domain: DOMAIN, envVar: ENV_VAR, configDir });

    expect(value).toBe("round-trip-token");
  });

  it("creates the parent directory when it does not exist yet", () => {
    // `configDir` (…/hiberus) is deliberately never created in `beforeEach`
    // — `persistCredential` itself must create it.
    const filePath = persistCredential(DOMAIN, "token-value", configDir);

    const contents = JSON.parse(readFileSync(filePath, "utf8")) as { token: string };
    expect(contents.token).toBe("token-value");
  });
});

describe("credentialFilePath", () => {
  it("resolves to $XDG_CONFIG_HOME/hiberus/<domain>.json under a given config dir", () => {
    const path = credentialFilePath(DOMAIN, "/tmp/example-config/hiberus");
    expect(path).toBe("/tmp/example-config/hiberus/example-domain.json");
  });
});
