// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md Phase 3). Covers: `selectAdminProvider`'s four
// precedence combinations; `PastedBearerProvider`'s expiry-before-any-request
// gate; the minted path's single-flight coalescing and its scope-claim
// verification (the 2026-09-17 correction — an `access_token` proves
// nothing about the admin scope on its own); `relayCredentialFailure`'s
// AdminScopeError → CredentialExpiredError rewrap; and the self-heal proof
// that a replaced stored Bearer takes effect on the very next call with no
// restart (the credential resolves PER CALL, never cached at startup).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialExpiredError, MissingCredentialError } from "@hiberus-magento/mcp-core";
import { AdminScopeError } from "./client/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACO_CLIENT_ID_ENV_VAR,
  ACO_CLIENT_SECRET_ENV_VAR,
  ACO_TOKEN_ENV_VAR,
  createAdminTokenProvider,
  createMintedAdminTokenProvider,
  PastedBearerProvider,
  relayCredentialFailure,
  resolveAcoCredentialDirect,
  selectAdminProvider,
} from "./credential-provider.js";

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** A JWT-shaped string whose payload segment decodes to `claims` — no real signature, matching `PastedBearerProvider`'s "no signature check" contract. */
function fakeJwt(claims: Record<string, unknown>): string {
  return `${base64url(JSON.stringify({ alg: "none" }))}.${base64url(JSON.stringify(claims))}.unsigned`;
}

describe("selectAdminProvider", () => {
  it.each([
    { storedOrEnvBearer: true, clientCredentials: true, expected: "pasted-bearer" },
    { storedOrEnvBearer: true, clientCredentials: false, expected: "pasted-bearer" },
    { storedOrEnvBearer: false, clientCredentials: true, expected: "minted" },
    { storedOrEnvBearer: false, clientCredentials: false, expected: "none" },
  ] as const)("storedOrEnvBearer=$storedOrEnvBearer clientCredentials=$clientCredentials -> $expected", ({ storedOrEnvBearer, clientCredentials, expected }) => {
    const result = selectAdminProvider({ storedOrEnvBearer, clientCredentials });
    expect(result.selection).toBe(expected);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("a stored/env Bearer wins over client credentials — never the reverse", () => {
    const result = selectAdminProvider({ storedOrEnvBearer: true, clientCredentials: true });
    expect(result.selection).toBe("pasted-bearer");
  });
});

describe("PastedBearerProvider", () => {
  let now: number;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    now = 1_000_000;
    fetchSpy.mockClear();
  });

  it("throws CredentialExpiredError BEFORE any request once the decoded expiry has elapsed", async () => {
    const createdAt = now - 10_000;
    const expiresIn = 5_000; // elapsed: createdAt + expiresIn < now
    const token = fakeJwt({ created_at: createdAt, expires_in: expiresIn });
    const provider = new PastedBearerProvider({
      domain: "aco",
      now: () => now,
      remedy: { domain: "aco", cliCommand: "hiberus-aco auth mint", envVar: ACO_TOKEN_ENV_VAR, configPath: "/tmp/aco.json", reason: "expired" },
      resolve: () => token,
    });

    await expect(provider.getToken()).rejects.toThrow(CredentialExpiredError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the decoded credential when the expiry has not elapsed", async () => {
    const createdAt = now - 1_000;
    const expiresIn = 60_000; // not elapsed
    const token = fakeJwt({ created_at: createdAt, expires_in: expiresIn });
    const provider = new PastedBearerProvider({
      domain: "aco",
      now: () => now,
      remedy: { domain: "aco", cliCommand: "hiberus-aco auth mint", envVar: ACO_TOKEN_ENV_VAR, configPath: "/tmp/aco.json", reason: "expired" },
      resolve: () => token,
    });

    const credential = await provider.getToken();
    expect(credential.value).toBe(token);
  });

  it("re-reads the resolve function on EVERY getToken() call — never cached at startup", async () => {
    const resolve = vi.fn(() => fakeJwt({ created_at: now - 1_000, expires_in: 60_000 }));
    const provider = new PastedBearerProvider({
      domain: "aco",
      now: () => now,
      remedy: { domain: "aco", cliCommand: "hiberus-aco auth mint", envVar: ACO_TOKEN_ENV_VAR, configPath: "/tmp/aco.json", reason: "expired" },
      resolve,
    });

    await provider.getToken();
    await provider.getToken();
    await provider.getToken();

    expect(resolve).toHaveBeenCalledTimes(3);
  });
});

describe("resolveAcoCredentialDirect self-heal (never cached at startup)", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-credentials-"));
    delete process.env[ACO_TOKEN_ENV_VAR];
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env[ACO_TOKEN_ENV_VAR];
  });

  it("an expired stored Bearer fails call 1; the replaced value succeeds on the immediate NEXT call, with no restart", async () => {
    const now = 2_000_000;
    const expiredToken = fakeJwt({ created_at: now - 100_000, expires_in: 1_000 });
    writeFileSync(join(configDir, "aco.json"), JSON.stringify({ token: expiredToken }), { mode: 0o600 });

    const provider = new PastedBearerProvider({
      domain: "aco",
      now: () => now,
      remedy: { domain: "aco", cliCommand: "hiberus-aco auth mint", envVar: ACO_TOKEN_ENV_VAR, configPath: join(configDir, "aco.json"), reason: "expired" },
      resolve: () => resolveAcoCredentialDirect(configDir),
    });

    // Call 1: expired -> rejects, no restart involved.
    await expect(provider.getToken()).rejects.toThrow(CredentialExpiredError);

    // Operator pastes a fresh Bearer while the "server" (this provider instance) keeps running.
    const freshToken = fakeJwt({ created_at: now - 1_000, expires_in: 60_000 });
    writeFileSync(join(configDir, "aco.json"), JSON.stringify({ token: freshToken }), { mode: 0o600 });

    // Call 2, on the SAME provider instance, no restart: succeeds immediately.
    const credential = await provider.getToken();
    expect(credential.value).toBe(freshToken);
  });
});

describe("createMintedAdminTokenProvider", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-minted-"));
    delete process.env[ACO_TOKEN_ENV_VAR];
    process.env[ACO_CLIENT_ID_ENV_VAR] = "synthetic-client-id";
    process.env[ACO_CLIENT_SECRET_ENV_VAR] = "synthetic-client-secret";
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env[ACO_TOKEN_ENV_VAR];
    delete process.env[ACO_CLIENT_ID_ENV_VAR];
    delete process.env[ACO_CLIENT_SECRET_ENV_VAR];
  });

  it("two concurrent calls with no cached token trigger exactly ONE IMS mint (single-flight coalescing)", async () => {
    vi.useFakeTimers();
    try {
      let mintCalls = 0;
      const grantedToken = fakeJwt({ scope: "commerce.aco.admin,openid,AdobeID" });
      const fetchDouble: typeof globalThis.fetch = async () => {
        mintCalls += 1;
        return new Response(JSON.stringify({ access_token: grantedToken, expires_in: 86399 }), { status: 200 });
      };

      const provider = createMintedAdminTokenProvider({ fetch: fetchDouble, now: () => Date.now() });

      const [first, second] = await Promise.all([provider.getToken(), provider.getToken()]);

      expect(mintCalls).toBe(1);
      expect(first.value).toBe(grantedToken);
      expect(second.value).toBe(grantedToken);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a minted token that carries FEWER scopes than requested — an access_token alone proves nothing", async () => {
    const tokenMissingAdminScope = fakeJwt({ scope: "openid,AdobeID" }); // no commerce.aco.admin
    const fetchDouble: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ access_token: tokenMissingAdminScope, expires_in: 86399 }), { status: 200 });

    const provider = createMintedAdminTokenProvider({ fetch: fetchDouble, now: () => Date.now() });

    await expect(provider.getToken()).rejects.toThrow(/commerce\.aco\.admin/);
  });

  it("rejects when IMS returns no access_token at all", async () => {
    const fetchDouble: typeof globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 400 });

    const provider = createMintedAdminTokenProvider({ fetch: fetchDouble, now: () => Date.now() });

    await expect(provider.getToken()).rejects.toThrow(MissingCredentialError);
  });
});

describe("relayCredentialFailure", () => {
  it("rewraps a live AdminScopeError as CredentialExpiredError naming both exits, preserving the original as cause", () => {
    const original = new AdminScopeError({ operationName: "ListCatalogViews", message: "insufficient scope for this operation" });

    let caught: unknown;
    try {
      relayCredentialFailure(original);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CredentialExpiredError);
    const message = (caught as Error).message;
    expect(message).toMatch(/hiberus-aco auth mint/);
    expect(message).toMatch(/hiberus-aco auth token set/);
    expect(message).toMatch(/insufficient scope for this operation/);
    expect((caught as Error).cause).toBe(original);
  });

  it("rethrows any other error unchanged — it is the ONLY place an AcoError becomes an mcp-core credential error", () => {
    const other = new Error("some unrelated failure");
    expect(() => relayCredentialFailure(other)).toThrow(other);
  });
});

describe("createAdminTokenProvider composition", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-composite-"));
    delete process.env[ACO_TOKEN_ENV_VAR];
    delete process.env[ACO_CLIENT_ID_ENV_VAR];
    delete process.env[ACO_CLIENT_SECRET_ENV_VAR];
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env[ACO_TOKEN_ENV_VAR];
    delete process.env[ACO_CLIENT_ID_ENV_VAR];
    delete process.env[ACO_CLIENT_SECRET_ENV_VAR];
  });

  it("with no stored Bearer and no client credentials, getToken() rejects with the canonical MissingCredentialError", async () => {
    const provider = createAdminTokenProvider({ now: () => Date.now(), fetch: (async () => new Response("{}"))!, configDir });
    await expect(provider.getToken()).rejects.toThrow(MissingCredentialError);
  });

  it("a stored Bearer is preferred even when client credentials are ALSO configured", async () => {
    process.env[ACO_CLIENT_ID_ENV_VAR] = "synthetic-client-id";
    process.env[ACO_CLIENT_SECRET_ENV_VAR] = "synthetic-client-secret";
    const validToken = fakeJwt({ created_at: Date.now() - 1_000, expires_in: 60_000 });
    writeFileSync(join(configDir, "aco.json"), JSON.stringify({ token: validToken }), { mode: 0o600 });

    let mintCalls = 0;
    const fetchDouble: typeof globalThis.fetch = async () => {
      mintCalls += 1;
      return new Response(JSON.stringify({ access_token: "unused", expires_in: 86399 }), { status: 200 });
    };

    const provider = createAdminTokenProvider({ now: () => Date.now(), fetch: fetchDouble, configDir });
    const credential = await provider.getToken();

    expect(credential.value).toBe(validToken);
    expect(mintCalls).toBe(0);
  });
});

describe("mint-failure remedies name both exits", () => {
  // Two structurally similar branches diverged: the no-token branch named both
  // recovery paths, its insufficient-scope sibling named only re-minting. An
  // operator who cannot add the API to the Console is then told to retry the
  // one thing that cannot work for them, with no mention of the paste exit
  // that can. Neither branch had a test checking message content at all.
  beforeEach(() => {
    delete process.env[ACO_TOKEN_ENV_VAR];
    process.env[ACO_CLIENT_ID_ENV_VAR] = "synthetic-client-id";
    process.env[ACO_CLIENT_SECRET_ENV_VAR] = "synthetic-client-secret";
  });

  afterEach(() => {
    delete process.env[ACO_CLIENT_ID_ENV_VAR];
    delete process.env[ACO_CLIENT_SECRET_ENV_VAR];
  });

  const mintWith = (body: unknown) => {
    const fetchDouble: typeof globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 });
    return createMintedAdminTokenProvider({ fetch: fetchDouble, now: () => Date.now() }).getToken();
  };

  it("names both exits when IMS returns no access_token", async () => {
    await expect(mintWith({ error: "unauthorized_client" })).rejects.toThrow(/Adobe Commerce Optimizer Admin/);
    await expect(mintWith({ error: "unauthorized_client" })).rejects.toThrow(/auth token set/);
  });

  it("names both exits when IMS grants a token without the required scope", async () => {
    const insufficient = { access_token: fakeJwt({ scope: "openid,AdobeID" }), expires_in: 86399 };
    await expect(mintWith(insufficient)).rejects.toThrow(/Adobe Commerce Optimizer Admin/);
    await expect(mintWith(insufficient)).rejects.toThrow(/auth token set/);
  });
});
