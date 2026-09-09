// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1): `EDS_TOKEN` must win over the config file when
// both are present (eds-cli spec, "Credential Precedence for the eds
// Domain"). Mirrors `packages/mcp-core/src/credentials/resolve.test.ts`'s
// pattern, now exercised through EDS's own wiring.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEdsTokenProvider, EDS_ENV_VAR, resolveEdsCredentialDirect } from "./credential-provider.js";

describe("createEdsTokenProvider", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "eds-credentials-"));
    delete process.env[EDS_ENV_VAR];
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env[EDS_ENV_VAR];
  });

  it("resolves EDS_TOKEN over the config file when both are present", async () => {
    process.env[EDS_ENV_VAR] = "from-env-9f3a";
    writeFileSync(join(configDir, "eds.json"), JSON.stringify({ token: "from-config-file" }), { mode: 0o600 });

    const provider = createEdsTokenProvider({ configDir });
    const credential = await provider.getToken();

    expect(credential.value).toBe("from-env-9f3a");
  });

  it("falls back to the config file when EDS_TOKEN is unset", async () => {
    writeFileSync(join(configDir, "eds.json"), JSON.stringify({ token: "from-config-file" }), { mode: 0o600 });

    const provider = createEdsTokenProvider({ configDir });
    const credential = await provider.getToken();

    expect(credential.value).toBe("from-config-file");
  });

  it("names hiberus-eds auth token set as the remedy CLI command", () => {
    const provider = createEdsTokenProvider({ configDir });
    expect(provider.describeRemedy().cliCommand).toBe("hiberus-eds auth token set");
    expect(provider.describeRemedy().envVar).toBe(EDS_ENV_VAR);
  });
});

describe("resolveEdsCredentialDirect", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "eds-credentials-direct-"));
    delete process.env[EDS_ENV_VAR];
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env[EDS_ENV_VAR];
  });

  it("surfaces LooseCredentialFilePermissionsError's message verbatim, not a generic missing-credential message", () => {
    writeFileSync(join(configDir, "eds.json"), JSON.stringify({ token: "leaked-if-read" }), { mode: 0o644 });

    expect(() => resolveEdsCredentialDirect(configDir)).toThrow(/permissions/i);
    expect(() => resolveEdsCredentialDirect(configDir)).not.toThrow(/^Missing credential/);
  });
});
