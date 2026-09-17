// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.3), mirrors `packages/eds/src/credential-provider.test.ts`
// (read-only precedent). Missing `MAGENTO_CLOUD_CLI_TOKEN` — neither the
// environment variable nor the config file resolves — throws
// `MissingCredentialError` naming the variable, and does so WITHOUT ever
// touching `child_process`: this module never calls `locateBinary` or
// `execFile` itself, so "before any process is spawned" is a structural
// property of never importing them, not a runtime race to win.
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingCredentialError } from "@hiberus-magento/mcp-core";

const execFileMock = vi.fn(
  (
    _file: string,
    _args: readonly string[],
    _options: Record<string, unknown>,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    callback(null, "ok", "");
    return new EventEmitter();
  },
);

vi.mock("node:child_process", () => ({
  execFile: (...args: Parameters<typeof execFileMock>) => execFileMock(...args),
}));

const {
  createMagentoCloudTokenProvider,
  MAGENTO_CLOUD_ENV_VAR,
  resolveMagentoCloudCredentialDirect,
} = await import("./credential-provider.js");

const CONFIG_FILE_CREDENTIAL_VALUE = "from-config-file";

describe("createMagentoCloudTokenProvider", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "magento-cloud-credentials-"));
    delete process.env[MAGENTO_CLOUD_ENV_VAR];
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env[MAGENTO_CLOUD_ENV_VAR];
  });

  it("resolves MAGENTO_CLOUD_CLI_TOKEN over the config file when both are present", async () => {
    process.env[MAGENTO_CLOUD_ENV_VAR] = "from-env-7c1d";
    writeFileSync(join(configDir, "magento-cloud.json"), JSON.stringify({ token: CONFIG_FILE_CREDENTIAL_VALUE }), { mode: 0o600 });

    const provider = createMagentoCloudTokenProvider({ configDir });
    const credential = await provider.getToken();

    expect(credential.value).toBe("from-env-7c1d");
  });

  it("falls back to the config file when MAGENTO_CLOUD_CLI_TOKEN is unset", async () => {
    writeFileSync(join(configDir, "magento-cloud.json"), JSON.stringify({ token: CONFIG_FILE_CREDENTIAL_VALUE }), { mode: 0o600 });

    const provider = createMagentoCloudTokenProvider({ configDir });
    const credential = await provider.getToken();

    expect(credential.value).toBe("from-config-file");
  });

  it("names hiberus-magento-cloud auth token set as the remedy CLI command", () => {
    const provider = createMagentoCloudTokenProvider({ configDir });

    expect(provider.describeRemedy().cliCommand).toBe("hiberus-magento-cloud auth token set");
    expect(provider.describeRemedy().envVar).toBe(MAGENTO_CLOUD_ENV_VAR);
  });
});

describe("resolveMagentoCloudCredentialDirect", () => {
  let configDir: string;

  beforeEach(() => {
    execFileMock.mockClear();
    configDir = mkdtempSync(join(tmpdir(), "magento-cloud-credentials-direct-"));
    delete process.env[MAGENTO_CLOUD_ENV_VAR];
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env[MAGENTO_CLOUD_ENV_VAR];
  });

  it("throws MissingCredentialError naming MAGENTO_CLOUD_CLI_TOKEN when neither source has a value, and never touches execFile", () => {
    expect(() => resolveMagentoCloudCredentialDirect(configDir)).toThrow(MissingCredentialError);
    try {
      resolveMagentoCloudCredentialDirect(configDir);
      throw new Error("expected resolveMagentoCloudCredentialDirect to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MissingCredentialError);
      expect((error as Error).message).toContain(MAGENTO_CLOUD_ENV_VAR);
    }
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("surfaces a loose-permissions credential file error verbatim, not a generic missing-credential message (contrast case)", () => {
    writeFileSync(join(configDir, "magento-cloud.json"), JSON.stringify({ token: "leaked-if-read" }), { mode: 0o644 });

    expect(() => resolveMagentoCloudCredentialDirect(configDir)).toThrow(/permissions/i);
    expect(() => resolveMagentoCloudCredentialDirect(configDir)).not.toThrow(/^Missing credential/);
  });
});
