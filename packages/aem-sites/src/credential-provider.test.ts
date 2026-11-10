// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MissingCredentialError, persistCredential } from "@hiberus-magento/mcp-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertEnvName, createAemTokenProvider, InvalidEnvironmentNameError, normalizeToken, resolveAemTokenDirect, tokenEnvVar } from "./credential-provider.js";

describe("normalizeToken", () => {
  it("accepts a raw token, a Bearer-prefixed one and the Developer Console JSON", () => {
    expect(normalizeToken("  abc.def  ")).toBe("abc.def");
    expect(normalizeToken("Bearer abc.def")).toBe("abc.def");
    expect(normalizeToken('{"ok":true,"accessToken":"abc.def","statusCode":200}')).toBe("abc.def");
    expect(normalizeToken('{"accessToken":"Bearer abc.def"}')).toBe("abc.def");
  });

  it("rejects empty, unreadable JSON and values with inner whitespace", () => {
    expect(normalizeToken("")).toBeUndefined();
    expect(normalizeToken("{not json")).toBeUndefined();
    expect(normalizeToken('{"other":"x"}')).toBeUndefined();
    expect(normalizeToken("abc def")).toBeUndefined();
  });
});

describe("environment names", () => {
  it("maps to AEM_TOKEN_<ENV>", () => {
    expect(tokenEnvVar("stage")).toBe("AEM_TOKEN_STAGE");
  });

  for (const name of ["Stage", "pre-prod", "", "a_b", "../x"]) {
    it(`refuses ${JSON.stringify(name)}`, () => {
      expect(() => assertEnvName(name)).toThrow(InvalidEnvironmentNameError);
    });
  }
});

describe("token resolution per environment", () => {
  let dir: string;
  let saved: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aem-sites-cred-"));
    saved = process.env.AEM_TOKEN_STAGE;
    delete process.env.AEM_TOKEN_STAGE;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) {
      delete process.env.AEM_TOKEN_STAGE;
    } else {
      process.env.AEM_TOKEN_STAGE = saved;
    }
  });

  it("prefers AEM_TOKEN_<ENV> and normalizes it", async () => {
    process.env.AEM_TOKEN_STAGE = "Bearer from-env";
    expect((await createAemTokenProvider("stage", { configDir: dir }).getToken()).value).toBe("from-env");
  });

  it("falls back to the 0600 file aem-sites-<env>.json", async () => {
    persistCredential("aem-sites-stage", "from-file", dir);
    expect((await createAemTokenProvider("stage", { configDir: dir }).getToken()).value).toBe("from-file");
  });

  it("re-reads on every call, so a renewed token needs no restart", async () => {
    const provider = createAemTokenProvider("stage", { configDir: dir });
    persistCredential("aem-sites-stage", "first", dir);
    expect((await provider.getToken()).value).toBe("first");
    persistCredential("aem-sites-stage", "second", dir);
    expect((await provider.getToken()).value).toBe("second");
  });

  it("keeps environments apart", async () => {
    persistCredential("aem-sites-stage", "stage-token", dir);
    await expect(createAemTokenProvider("prod", { configDir: dir }).getToken()).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it("names the per-environment remedy when nothing is stored", async () => {
    const error = (await createAemTokenProvider("stage", { configDir: dir }).getToken().catch((e: unknown) => e)) as MissingCredentialError;
    expect(error.message).toContain("hiberus-aem-sites auth token set --env stage");
    expect(error.message).toContain("AEM_TOKEN_STAGE");
  });

  it("surfaces a loose-permission file verbatim", () => {
    const file = join(dir, "aem-sites-stage.json");
    writeFileSync(file, JSON.stringify({ token: "x" }));
    chmodSync(file, 0o644);
    expect(() => resolveAemTokenDirect("stage", dir)).toThrow(/Refusing to read credential file/);
  });
});
