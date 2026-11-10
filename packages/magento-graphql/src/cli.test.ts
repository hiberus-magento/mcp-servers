// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The operator CLI is the only place a credential is ever typed, so what these pin is
// where it can and cannot travel: stdin in, a file at 0600 out, and never argv, never stdout.
// The customer token is OPTIONAL here, so `auth status` with none is a normal answer, not a failure.
import { SYNTHETIC_MAGENTO_CUSTOMER_TOKEN } from "@hiberus-magento/mcp-testing";
import { describe, expect, it, vi } from "vitest";
import { MagentoGraphqlError } from "./client/index.js";
import { runCli, type CliDeps } from "./cli.js";

const deps = (overrides: Partial<CliDeps> = {}): CliDeps => ({
  readStdin: async () => `${SYNTHETIC_MAGENTO_CUSTOMER_TOKEN}\n`,
  persist: () => "/home/demo/.config/hiberus/magento-graphql.json",
  resolveToken: () => SYNTHETIC_MAGENTO_CUSTOMER_TOKEN,
  probe: async () => ({ storeConfig: { store_code: "default" } }),
  ...overrides,
});

describe("runCli", () => {
  it.each([["--token", SYNTHETIC_MAGENTO_CUSTOMER_TOKEN], [`--token=${SYNTHETIC_MAGENTO_CUSTOMER_TOKEN}`]])("rejects the token flag %j before doing anything", async (...rest) => {
    const persist = vi.fn(() => "/x");
    const result = await runCli(["auth", "token", "set", ...rest], deps({ persist }));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/stdin/);
    expect(persist).not.toHaveBeenCalled();
  });

  describe("auth token set", () => {
    it("reads the token from stdin, persists it, and prints the path but never the token", async () => {
      const persist = vi.fn(() => "/home/demo/.config/hiberus/magento-graphql.json");
      const result = await runCli(["auth", "token", "set"], deps({ persist }));
      expect(persist).toHaveBeenCalledWith(SYNTHETIC_MAGENTO_CUSTOMER_TOKEN);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("magento-graphql.json");
      expect(`${result.stdout}${result.stderr}`).not.toContain(SYNTHETIC_MAGENTO_CUSTOMER_TOKEN);
    });

    it("refuses an empty token and persists nothing", async () => {
      const persist = vi.fn(() => "/x");
      const result = await runCli(["auth", "token", "set"], deps({ persist, readStdin: async () => "  \n" }));
      expect(result.exitCode).toBe(1);
      expect(persist).not.toHaveBeenCalled();
    });

    it("takes no extra arguments", async () => {
      const result = await runCli(["auth", "token", "set", "abc"], deps());
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/no arguments/);
    });
  });

  describe("auth status", () => {
    it("prints a fingerprint and the probe verdict, never the token", async () => {
      const result = await runCli(["auth", "status"], deps());
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/customer token fingerprint: [0-9a-f]{8}/);
      expect(result.stdout).toMatch(/reachable/);
      expect(result.stdout).not.toContain(SYNTHETIC_MAGENTO_CUSTOMER_TOKEN);
    });

    it("with no token says calls are anonymous, still probes, and exits 0", async () => {
      const probe = vi.fn(async () => ({}));
      const result = await runCli(["auth", "status"], deps({ resolveToken: () => undefined, probe }));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/anonymous/);
      expect(probe).toHaveBeenCalled();
    });

    it("reports an unreachable endpoint, and exits 1", async () => {
      const error = new MagentoGraphqlError({ kind: "transport", message: "Magento GraphQL request failed before a response was received." });
      const result = await runCli(["auth", "status"], deps({ probe: async () => { throw error; } }));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("transport");
    });

    it("reports a rejected customer token with its remedy, and exits 1", async () => {
      const error = new MagentoGraphqlError({ kind: "unauthorized", message: "Magento GraphQL: bad", remedy: "Set the token." });
      const result = await runCli(["auth", "status"], deps({ probe: async () => { throw error; } }));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Set the token.");
    });

    it("explains a credential file it cannot read (loose permissions), and exits 1", async () => {
      const result = await runCli(["auth", "status"], deps({ resolveToken: () => { throw new Error('Refusing to read credential file "/x": mode 644 has group/world permissions.'); } }));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("permissions");
    });

    it("surfaces an unexpected failure with credential-shaped values redacted", async () => {
      const result = await runCli(["auth", "status"], deps({ probe: async () => { throw new Error("boom Authorization: Bearer demo-bearer-99"); } }));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).not.toContain("demo-bearer-99");
    });
  });

  it("rejects an unknown command", async () => {
    const result = await runCli(["products", "list"], deps());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });
});
