// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.3, 6.5, 6.7, 6.9, 6.11, 6.13, 6.15): the `hiberus-eds`
// CLI's auth surface. Every scenario here maps directly to an eds-cli spec
// requirement.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFetchDouble } from "./testing/fetch-double.js";
import { createEdsClient } from "./client/index.js";
import { EDS_ENV_VAR } from "./credential-provider.js";
import { CLI_OPTIONS, main, runCli, setToken } from "./cli.js";

const SECRET_LOOKING_NAME = /token|key|secret|password/i;

describe("CLI_OPTIONS", () => {
  it("contains no option name that could carry a credential", () => {
    const offending = CLI_OPTIONS.filter((option) => SECRET_LOOKING_NAME.test(option.name));
    expect(offending).toEqual([]);
  });
});

describe("runCli — token as a CLI argument is rejected before dispatch", () => {
  it("rejects --token <value> before persisting anything", async () => {
    let persisted = false;
    const result = await runCli(["auth", "token", "set", "--token", "abc123"], {
      readStdin: async () => "should-never-be-read",
      persist: () => {
        persisted = true;
        return "/dev/null";
      },
      configDir: undefined,
      client: createEdsClient({
        fetch: createFetchDouble({}).fetch,
        now: () => Date.now(),
        sleep: async () => undefined,
        tokenProvider: { domain: "eds", getToken: async () => ({ kind: "static", value: "x" }), invalidate: () => undefined, describeRemedy: () => ({ domain: "eds", cliCommand: "c", envVar: "e", configPath: "p", reason: "r" }) },
        baseUrl: "https://admin.hlx.page",
        org: "acme-demo-org",
      }),
      org: "acme-demo-org",
    });

    expect(result.exitCode).not.toBe(0);
    expect(persisted).toBe(false);
    expect(result.stderr).toMatch(/stdin/i);
  });

  it("rejects a positional token argument the same way, before persisting anything", async () => {
    let persistedValue: string | undefined;
    const result = await runCli(["auth", "token", "set", "abc123"], {
      // Deliberately different from the positional value: if the positional
      // argument were ever wired into persistence, `persistedValue` would
      // equal "abc123" instead of this stdin value — it must not.
      readStdin: async () => "value-from-stdin-should-not-be-reached",
      persist: (token) => {
        persistedValue = token;
        return "/dev/null";
      },
      configDir: undefined,
      client: createEdsClient({
        fetch: createFetchDouble({}).fetch,
        now: () => Date.now(),
        sleep: async () => undefined,
        tokenProvider: { domain: "eds", getToken: async () => ({ kind: "static", value: "x" }), invalidate: () => undefined, describeRemedy: () => ({ domain: "eds", cliCommand: "c", envVar: "e", configPath: "p", reason: "r" }) },
        baseUrl: "https://admin.hlx.page",
        org: "acme-demo-org",
      }),
      org: "acme-demo-org",
    });

    // `parseCredentialCliArgs` (mcp-core) only recognizes the flag forms
    // (--token/--token=); a bare positional value is rejected instead by
    // `auth token set`'s own arity check, since the command accepts no
    // positional arguments at all — pipe via stdin only.
    expect(result.exitCode).not.toBe(0);
    expect(persistedValue).toBeUndefined();
    expect(result.stderr).toMatch(/stdin/i);
  });
});

describe("setToken", () => {
  it("has no token parameter in its signature — reads from injected stdin only", async () => {
    let persistedValue: string | undefined;
    const result = await setToken({
      readStdin: async () => "piped-secret-value",
      persist: (token) => {
        persistedValue = token;
        return "/config/eds.json";
      },
    });

    expect(result.exitCode).toBe(0);
    expect(persistedValue).toBe("piped-secret-value");
  });
});

describe("auth mint", () => {
  // CHANGED DELIBERATELY: this case used to route the site-level path
  // `/config/{org}/sites/{site}/apiKeys.json` and assert an `expiresAt`
  // field. Observed live, that path answers 404 and key records carry
  // `expiration` — EDS API keys are an ORG-level resource, so `--site` is
  // not part of minting at all.
  it("prints the minted value alone on stdout; stderr carries the unrecoverable-value banner, id, roles, expiry, and next command; value appears exactly once", async () => {
    const path = "/config/acme-demo-org/apiKeys.json";
    const { fetch } = createFetchDouble({
      [`POST ${path}`]: { status: 200, body: { id: "key-1", value: "minted-once-9f3a", roles: ["publish"], expiration: "2027-01-01T00:00:00Z" } },
    });
    const client = createEdsClient({
      fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      tokenProvider: { domain: "eds", getToken: async () => ({ kind: "static", value: "x" }), invalidate: () => undefined, describeRemedy: () => ({ domain: "eds", cliCommand: "c", envVar: "e", configPath: "p", reason: "r" }) },
      baseUrl: "https://admin.hlx.page",
      org: "acme-demo-org",
    });

    const result = await runCli(["auth", "mint", "--roles", "publish"], {
      readStdin: async () => "",
      persist: () => "/dev/null",
      configDir: undefined,
      client,
      org: "acme-demo-org",
    });

    expect(result.stdout).toBe("minted-once-9f3a\n");
    expect(result.stderr).toMatch(/shown once|never be shown again|cannot be retrieved/i);
    expect(result.stderr).toContain("key-1");
    expect(result.stderr).toContain("publish");
    expect(result.stderr).toContain("2027-01-01T00:00:00Z");

    const occurrences = `${result.stdout ?? ""}${result.stderr ?? ""}`.split("minted-once-9f3a").length - 1;
    expect(occurrences).toBe(1);
  });

  it("rejects a role outside the documented enum", async () => {
    const client = createEdsClient({
      fetch: createFetchDouble({}).fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      tokenProvider: { domain: "eds", getToken: async () => ({ kind: "static", value: "x" }), invalidate: () => undefined, describeRemedy: () => ({ domain: "eds", cliCommand: "c", envVar: "e", configPath: "p", reason: "r" }) },
      baseUrl: "https://admin.hlx.page",
      org: "acme-demo-org",
    });

    const result = await runCli(["auth", "mint", "--roles", "superuser"], {
      readStdin: async () => "",
      persist: () => "/dev/null",
      configDir: undefined,
      client,
      org: "acme-demo-org",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/superuser/);
  });

  // The create response was never observed live. If it carries no value the
  // parser recognises, the operator must be told that plainly — printing
  // "undefined" as a key would be the worst possible answer here.
  it("fails loudly, printing no key line, when the response carries no key value", async () => {
    const { fetch } = createFetchDouble({
      "POST /config/acme-demo-org/apiKeys.json": {
        status: 200,
        body: { id: "key-2", roles: ["publish"], expiration: "2027-01-01T00:00:00Z", description: "demo key" },
      },
    });
    const client = createEdsClient({
      fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      tokenProvider: { domain: "eds", getToken: async () => ({ kind: "static", value: "x" }), invalidate: () => undefined, describeRemedy: () => ({ domain: "eds", cliCommand: "c", envVar: "e", configPath: "p", reason: "r" }) },
      baseUrl: "https://admin.hlx.page",
      org: "acme-demo-org",
    });

    const result = await runCli(["auth", "mint", "--roles", "publish"], {
      readStdin: async () => "",
      persist: () => "/dev/null",
      configDir: undefined,
      client,
      org: "acme-demo-org",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout ?? "").toBe("");
    expect(result.stderr ?? "").not.toContain("undefined");
    expect(result.stderr).toContain("key-2");
    expect(result.stderr).toContain("hiberus-eds auth keys list");
  });
});

describe("auth keys list", () => {
  const LIST_BODY = {
    "demo-secret-shaped-outer-key": {
      description: "demo publishing key",
      roles: ["config_admin"],
      id: "demo-key-0001",
      subject: "demo-author@example-domain",
      expiration: "2027-01-01T00:00:00Z",
      created: "2026-10-20T00:00:00Z",
    },
  };

  function clientFor(body: unknown) {
    const { fetch } = createFetchDouble({ "GET /config/acme-demo-org/apiKeys.json": { status: 200, body } } as never);
    return createEdsClient({
      fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      tokenProvider: { domain: "eds", getToken: async () => ({ kind: "static", value: "x" }), invalidate: () => undefined, describeRemedy: () => ({ domain: "eds", cliCommand: "c", envVar: "e", configPath: "p", reason: "r" }) },
      baseUrl: "https://admin.hlx.page",
      org: "acme-demo-org",
    });
  }

  it("lists each key's metadata and NEVER the secret-shaped object key", async () => {
    const result = await runCli(["auth", "keys", "list"], {
      readStdin: async () => "",
      persist: () => "/dev/null",
      configDir: undefined,
      client: clientFor(LIST_BODY),
      org: "acme-demo-org",
    });

    expect(result.exitCode).toBe(0);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(output).toContain("demo-key-0001");
    expect(output).toContain("config_admin");
    expect(output).not.toContain("demo-secret-shaped-outer-key");
  });

  it("says so plainly when the org has no keys", async () => {
    const result = await runCli(["auth", "keys", "list"], {
      readStdin: async () => "",
      persist: () => "/dev/null",
      configDir: undefined,
      client: clientFor({}),
      org: "acme-demo-org",
    });

    expect(result.exitCode).toBe(0);
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).toMatch(/no api keys/i);
  });
});

describe("auth status", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "eds-cli-status-"));
    delete process.env[EDS_ENV_VAR];
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env[EDS_ENV_VAR];
  });

  it("never contains the token value in stdout or stderr, under any outcome", async () => {
    writeFileSync(join(configDir, "eds.json"), JSON.stringify({ token: "must-never-leak-9f3a" }), { mode: 0o600 });
    const { fetch } = createFetchDouble({
      "GET /config/acme-demo-org.json": { status: 200, body: {} },
      "GET /config/acme-demo-org/sites.json": { status: 200, body: [] },
    });
    const client = createEdsClient({
      fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      tokenProvider: { domain: "eds", getToken: async () => ({ kind: "static", value: "must-never-leak-9f3a" }), invalidate: () => undefined, describeRemedy: () => ({ domain: "eds", cliCommand: "c", envVar: "e", configPath: "p", reason: "r" }) },
      baseUrl: "https://admin.hlx.page",
      org: "acme-demo-org",
    });

    const result = await runCli(["auth", "status"], {
      readStdin: async () => "",
      persist: () => "/dev/null",
      configDir,
      client,
      org: "acme-demo-org",
    });

    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(combined).not.toContain("must-never-leak-9f3a");
    expect(result.exitCode).toBe(0);
  });

  it("surfaces LooseCredentialFilePermissionsError verbatim, not a generic missing-credential message", async () => {
    writeFileSync(join(configDir, "eds.json"), JSON.stringify({ token: "irrelevant" }), { mode: 0o644 });
    const client = createEdsClient({
      fetch: createFetchDouble({}).fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      tokenProvider: { domain: "eds", getToken: async () => ({ kind: "static", value: "x" }), invalidate: () => undefined, describeRemedy: () => ({ domain: "eds", cliCommand: "c", envVar: "e", configPath: "p", reason: "r" }) },
      baseUrl: "https://admin.hlx.page",
      org: "acme-demo-org",
    });

    const result = await runCli(["auth", "status"], {
      readStdin: async () => "",
      persist: () => "/dev/null",
      configDir,
      client,
      org: "acme-demo-org",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/permissions/i);
    expect(result.stderr).not.toMatch(/^Missing credential/);
  });
});

describe("main — exit codes reflect outcome (tasks.md 8.1/8.2)", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("sets process.exitCode to 0 on auth status success", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "eds-cli-main-"));
    try {
      writeFileSync(join(configDir, "eds.json"), JSON.stringify({ token: "irrelevant-9f3a" }), { mode: 0o600 });
      const { fetch } = createFetchDouble({
        "GET /config/acme-demo-org.json": { status: 200, body: {} },
        "GET /config/acme-demo-org/sites.json": { status: 200, body: [] },
      });
      const client = createEdsClient({
        fetch,
        now: () => Date.now(),
        sleep: async () => undefined,
        tokenProvider: { domain: "eds", getToken: async () => ({ kind: "static", value: "irrelevant-9f3a" }), invalidate: () => undefined, describeRemedy: () => ({ domain: "eds", cliCommand: "c", envVar: "e", configPath: "p", reason: "r" }) },
        baseUrl: "https://admin.hlx.page",
        org: "acme-demo-org",
      });
      process.exitCode = undefined;

      await main(["auth", "status"], { readStdin: async () => "", persist: () => "/dev/null", configDir, client, org: "acme-demo-org" });

      expect(process.exitCode).toBe(0);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("sets process.exitCode to non-zero on a missing credential", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "eds-cli-main-"));
    try {
      delete process.env[EDS_ENV_VAR];
      const client = createEdsClient({
        fetch: createFetchDouble({}).fetch,
        now: () => Date.now(),
        sleep: async () => undefined,
        tokenProvider: { domain: "eds", getToken: async () => ({ kind: "static", value: "x" }), invalidate: () => undefined, describeRemedy: () => ({ domain: "eds", cliCommand: "c", envVar: "e", configPath: "p", reason: "r" }) },
        baseUrl: "https://admin.hlx.page",
        org: "acme-demo-org",
      });
      process.exitCode = 0;

      await main(["auth", "status"], { readStdin: async () => "", persist: () => "/dev/null", configDir, client, org: "acme-demo-org" });

      expect(process.exitCode).not.toBe(0);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
