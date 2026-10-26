// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The operator CLI is the only place a credential is ever typed,
// so what these pin is where it can and cannot travel: stdin in, a file at
// 0600 out, and never argv, never stdout.
import { MissingCredentialError } from "@hiberus-magento/mcp-core";
import { SYNTHETIC_MAGENTO_TOKEN } from "@hiberus-magento/mcp-testing";
import { describe, expect, it, vi } from "vitest";
import { MagentoRestError } from "./client/index.js";
import { runCli, type CliDeps } from "./cli.js";

const missing = new MissingCredentialError({
  domain: "magento-rest",
  cliCommand: "hiberus-magento-rest auth token set",
  envVar: "MAGENTO_REST_TOKEN",
  configPath: "/home/demo/.config/hiberus/magento-rest.json",
  reason: "none",
});

const deps = (overrides: Partial<CliDeps> = {}): CliDeps => ({
  readStdin: async () => `${SYNTHETIC_MAGENTO_TOKEN}\n`,
  persist: () => "/home/demo/.config/hiberus/magento-rest.json",
  persistDbPassword: () => "/home/demo/.config/hiberus/magento-rest-db.json",
  resolveToken: () => SYNTHETIC_MAGENTO_TOKEN,
  probe: async () => [{ id: 1 }],
  ...overrides,
});

describe("runCli", () => {
  it.each([["--token", SYNTHETIC_MAGENTO_TOKEN], [`--token=${SYNTHETIC_MAGENTO_TOKEN}`]])("rejects the token flag %j before doing anything", async (...rest) => {
    const persist = vi.fn(() => "/x");
    const result = await runCli(["auth", "token", "set", ...rest], deps({ persist }));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/stdin/);
    expect(persist).not.toHaveBeenCalled();
  });

  describe("auth db-password set", () => {
    const PASSWORD = "synthetic-pw-3";

    it("reads the password from stdin, stores it under its own file, and prints the path but never the password", async () => {
      const persistDbPassword = vi.fn(() => "/home/demo/.config/hiberus/magento-rest-db.json");
      const persist = vi.fn(() => "/x");
      const result = await runCli(["auth", "db-password", "set"], deps({ persistDbPassword, persist, readStdin: async () => `${PASSWORD}\n` }));
      expect(persistDbPassword).toHaveBeenCalledWith(PASSWORD);
      expect(persist).not.toHaveBeenCalled();
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("magento-rest-db.json");
      expect(`${result.stdout}${result.stderr}`).not.toContain(PASSWORD);
    });

    it("refuses an empty password and stores nothing", async () => {
      const persistDbPassword = vi.fn(() => "/x");
      const result = await runCli(["auth", "db-password", "set"], deps({ persistDbPassword, readStdin: async () => "\n" }));
      expect(result.exitCode).toBe(1);
      expect(persistDbPassword).not.toHaveBeenCalled();
    });

    it("takes no argument: a password on the command line would be in shell history", async () => {
      const persistDbPassword = vi.fn(() => "/x");
      const result = await runCli(["auth", "db-password", "set", PASSWORD], deps({ persistDbPassword }));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/stdin/);
      expect(result.stderr).not.toContain(PASSWORD);
      expect(persistDbPassword).not.toHaveBeenCalled();
    });
  });

  describe("auth token set", () => {
    it("reads the token from stdin, persists it, and prints the path but never the token", async () => {
      const persist = vi.fn(() => "/home/demo/.config/hiberus/magento-rest.json");
      const result = await runCli(["auth", "token", "set"], deps({ persist }));
      expect(persist).toHaveBeenCalledWith(SYNTHETIC_MAGENTO_TOKEN);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("magento-rest.json");
      expect(`${result.stdout}${result.stderr}`).not.toContain(SYNTHETIC_MAGENTO_TOKEN);
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
      expect(result.stdout).toMatch(/key fingerprint: [0-9a-f]{8}/);
      expect(result.stdout).toMatch(/reachable/);
      expect(result.stdout).not.toContain(SYNTHETIC_MAGENTO_TOKEN);
    });

    it("explains a missing credential with the remedy, and exits 1", async () => {
      const result = await runCli(["auth", "status"], deps({ resolveToken: () => { throw missing; } }));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("hiberus-magento-rest auth token set");
    });

    it("reports a rejected token as unauthorized, and exits 1", async () => {
      const unauthorized = new MagentoRestError({ kind: "unauthorized", message: "Magento REST HTTP 401: bad", status: 401, remedy: "Set the token." });
      const result = await runCli(["auth", "status"], deps({ probe: async () => { throw unauthorized; } }));
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unauthorized");
      expect(result.stderr).toContain("Set the token.");
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
