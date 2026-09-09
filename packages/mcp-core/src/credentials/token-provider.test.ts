// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { CredentialExpiredError, MintedTokenProvider, MissingCredentialError, StaticTokenProvider } from "./token-provider.js";

const REMEDY = {
  domain: "example-domain",
  cliCommand: "hiberus-example auth token set",
  envVar: "EXAMPLE_DOMAIN_TOKEN",
  configPath: "$XDG_CONFIG_HOME/hiberus/example-domain.json",
  reason: "not found",
};

describe("StaticTokenProvider", () => {
  it("resolves a static credential once", async () => {
    const provider = new StaticTokenProvider({ domain: "example-domain", resolve: () => "static-value", remedy: REMEDY });

    const credential = await provider.getToken();

    expect(credential).toEqual({ kind: "static", value: "static-value" });
  });

  it("maps a resolution failure to MissingCredentialError carrying the remedy", async () => {
    const provider = new StaticTokenProvider({
      domain: "example-domain",
      resolve: () => {
        throw new Error("not found");
      },
      remedy: REMEDY,
    });

    await expect(provider.getToken()).rejects.toBeInstanceOf(MissingCredentialError);
  });
});

describe("MintedTokenProvider", () => {
  it("coalesces concurrent getToken() calls into a single in-flight mint", async () => {
    let mintCalls = 0;
    const provider = new MintedTokenProvider({
      domain: "example-domain",
      mint: async () => {
        mintCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { value: "minted-value", expiresAt: Date.now() + 60_000 };
      },
      mintTimeoutMs: 1000,
      remedy: REMEDY,
    });

    const [first, second] = await Promise.all([provider.getToken(), provider.getToken()]);

    expect(mintCalls).toBe(1);
    expect(first).toEqual(second);
  });

  it("re-mints only the generation invalidate() targets, not a fresher one", async () => {
    let mintCalls = 0;
    const provider = new MintedTokenProvider({
      domain: "example-domain",
      mint: async () => {
        mintCalls += 1;
        return { value: `minted-${mintCalls}`, expiresAt: Date.now() + 60_000 };
      },
      mintTimeoutMs: 1000,
      remedy: REMEDY,
    });

    await provider.getToken();
    const staleGeneration = provider.getGeneration();

    // A stale generation (already superseded) must not clear the current
    // cache — invalidate() only affects the exact generation that produced
    // the credential a caller is reporting a 401 for.
    provider.invalidate(staleGeneration - 1);
    const stillCached = await provider.getToken();
    expect(mintCalls).toBe(1);
    expect(stillCached).toEqual({ kind: "minted", value: "minted-1", expiresAt: expect.any(Number) });

    provider.invalidate(staleGeneration);
    const reMinted = await provider.getToken();
    expect(mintCalls).toBe(2);
    expect(reMinted).toEqual({ kind: "minted", value: "minted-2", expiresAt: expect.any(Number) });
  });

  it("fails fast via MissingCredentialError when mint exceeds mintTimeoutMs, instead of hanging", async () => {
    const provider = new MintedTokenProvider({
      domain: "example-domain",
      mint: () => new Promise(() => {}), // never resolves
      mintTimeoutMs: 30,
      remedy: REMEDY,
    });

    const start = Date.now();
    await expect(provider.getToken()).rejects.toBeInstanceOf(MissingCredentialError);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("CredentialExpiredError", () => {
  it("carries the remedy for a defineTool wrapper to format", () => {
    const error = new CredentialExpiredError(REMEDY);
    expect(error.remedy).toEqual(REMEDY);
    expect(error).toBeInstanceOf(Error);
  });
});

