// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The runtime resolver is the only reader of the environment; it is lazy so
// `tools/list` works before the base URL is set, and it renders every failure without a raw body.
import { SYNTHETIC_MAGENTO_GRAPHQL_URL } from "@hiberus-magento/mcp-testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { MagentoGraphqlError, OperationGuardError } from "../client/index.js";
import { ALLOW_WRITES_ENV_VAR, BASE_URL_ENV_VAR, GROUPS_ENV_VAR, STORE_ENV_VAR, createRuntimeResolver, readGroupsFromEnv, toErrorResult, writesEnabled } from "./runtime.js";

const NAMES = [BASE_URL_ENV_VAR, STORE_ENV_VAR, ALLOW_WRITES_ENV_VAR, GROUPS_ENV_VAR, "MAGENTO_GRAPHQL_TOKEN"];

describe("runtime", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
    for (const n of NAMES) delete process.env[n];
  });
  afterEach(() => {
    for (const [n, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  });

  it("refuses without the base URL, naming the variable, and tries again on the next call", () => {
    const resolve = createRuntimeResolver();
    expect(() => resolve()).toThrow(BASE_URL_ENV_VAR);
    process.env[BASE_URL_ENV_VAR] = SYNTHETIC_MAGENTO_GRAPHQL_URL;
    expect(() => resolve()).not.toThrow();
  });

  it("does not cache a half-built runtime when the URL is bad", () => {
    const resolve = createRuntimeResolver();
    process.env[BASE_URL_ENV_VAR] = "http://demo-host.example-domain/graphql";
    expect(() => resolve()).toThrow(/https/);
    process.env[BASE_URL_ENV_VAR] = SYNTHETIC_MAGENTO_GRAPHQL_URL;
    expect(() => resolve()).not.toThrow();
  });

  it("names MAGENTO_GRAPHQL_STORE when it is not a store code", () => {
    process.env[BASE_URL_ENV_VAR] = SYNTHETIC_MAGENTO_GRAPHQL_URL;
    process.env[STORE_ENV_VAR] = "Not A Code";
    expect(() => createRuntimeResolver()()).toThrow(STORE_ENV_VAR);
  });

  it("enables writes only for the exact string true", () => {
    expect(writesEnabled()).toBe(false);
    for (const v of ["1", "yes", "TRUE", "True", ""]) {
      process.env[ALLOW_WRITES_ENV_VAR] = v;
      expect(writesEnabled(), v).toBe(false);
    }
    process.env[ALLOW_WRITES_ENV_VAR] = "true";
    expect(writesEnabled()).toBe(true);
  });

  it("reads groups case-insensitively, and names the variable on an unknown one", () => {
    expect(readGroupsFromEnv()).toEqual([]);
    process.env[GROUPS_ENV_VAR] = " Products, cart ,products";
    expect(readGroupsFromEnv()).toEqual(["products", "cart"]);
    process.env[GROUPS_ENV_VAR] = "products,cartt";
    expect(() => readGroupsFromEnv()).toThrow(/MAGENTO_GRAPHQL_GROUPS.*cartt/);
  });
});

describe("toErrorResult", () => {
  it("renders a classified error with its remedy", () => {
    const result = toErrorResult(new MagentoGraphqlError({ kind: "unauthorized", message: "Magento GraphQL: nope", remedy: "Set the token." }));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Magento GraphQL: nope\nRemedy: Set the token.");
  });

  it("renders a guard refusal as is", () => {
    expect(toErrorResult(new OperationGuardError("This tool runs queries only; the document is a mutation.")).content[0]?.text).toContain("queries only");
  });

  it("renders invalid arguments with their paths", () => {
    let error: unknown;
    try {
      z.object({ a: z.number() }).parse({ a: "x" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ZodError);
    expect(toErrorResult(error).content[0]?.text).toMatch(/^Invalid arguments: a:/);
  });

  it("redacts a credential inside an unexpected error", () => {
    expect(toErrorResult(new Error("boom Authorization: Bearer demo-bearer-99")).content[0]?.text).not.toContain("demo-bearer-99");
  });
});
