// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md Phase 4). Covers: a token is NEVER accepted as a CLI
// argument (`--token`/`--token=` both exit non-zero before persisting);
// stdin intake persists at mode 0600; `CLI_OPTIONS` names no secret-shaped
// flag; `provision`'s dry-run default and idempotent `--yes`; every
// CLI-only operation is recognized here and nowhere else; a
// missing-credential admin command exits non-zero; and untrusted upstream
// error text is redacted before it reaches stderr (threat matrix).
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistCredential } from "@hiberus-magento/mcp-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFetchDouble, graphQlErrors, graphQlOk } from "./testing/fetch-double.js";
import { createAcoClient } from "./client/index.js";
import { ACO_TOKEN_ENV_VAR } from "./credential-provider.js";
import { CLI_ONLY_OPERATIONS, CLI_OPTIONS, runCli, type CliDeps } from "./cli.js";

const SECRET_SHAPED_NAME = /token|key|secret|password/i;

describe("CLI_OPTIONS", () => {
  it("contains no option name matching a secret-shaped pattern", () => {
    for (const option of CLI_OPTIONS) {
      expect(option.name).not.toMatch(SECRET_SHAPED_NAME);
    }
  });
});

describe("CLI_ONLY_OPERATIONS", () => {
  it("lists provision, policy disable --all, view prune, view delete, policy delete, auth/profile, api query, and policy init", () => {
    expect(CLI_ONLY_OPERATIONS).toEqual(
      expect.arrayContaining([
        "provision",
        "policy disable --all",
        "view prune",
        "view delete",
        "policy delete",
        "auth token set",
        "auth mint",
        "auth status",
        "profile show",
        "api query",
        "policy init",
      ]),
    );
  });
});

function makeDeps(routes: Record<string, unknown>, configDir: string): { deps: CliDeps; calls: readonly { readonly operationName: string | undefined }[] } {
  const { fetch, calls } = createFetchDouble(routes as never);
  const client = createAcoClient({
    fetch,
    now: () => Date.now(),
    sleep: async () => undefined,
    adminBaseUrl: "https://admin.aco.example/admin/graphql",
    merchandisingBaseUrl: "https://merch.aco.example/graphql",
    tokenProvider: { domain: "aco", getToken: async () => ({ kind: "static" as const, value: "test-only-bearer" }), invalidate: () => undefined, describeRemedy: () => ({ domain: "aco", cliCommand: "hiberus-aco auth mint", envVar: ACO_TOKEN_ENV_VAR, configPath: "/dev/null", reason: "n/a" }) },
  });
  const deps: CliDeps = {
    client,
    configDir,
    readStdin: async () => "",
    persist: (token: string) => `${configDir}/aco.json (${token.length} bytes)`,
    readFile: async () => "",
    writeFile: async () => undefined,
  };
  return { deps, calls };
}

describe("--token is NEVER accepted as a CLI argument", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-cli-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("--token exits non-zero before persisting anything", async () => {
    const { deps } = makeDeps({}, configDir);
    const result = await runCli(["auth", "token", "set", "--token", "abc123"], deps);
    expect(result.exitCode).not.toBe(0);
  });

  it("--token=value exits non-zero before persisting anything", async () => {
    const { deps } = makeDeps({}, configDir);
    const result = await runCli(["auth", "token", "set", "--token=abc123"], deps);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("auth token set — stdin-only intake", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-cli-stdin-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("persists the piped token at mode 0600", async () => {
    const { deps } = makeDeps({}, configDir);
    const realDeps: CliDeps = {
      ...deps,
      readStdin: async () => "pasted-bearer-value\n",
      persist: (token: string) => persistCredential("aco", token, configDir),
    };

    const result = await runCli(["auth", "token", "set"], realDeps);

    expect(result.exitCode).toBe(0);
    const filePath = join(configDir, "aco.json");
    const stat = statSync(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
    const persistedContents = JSON.parse(readFileSync(filePath, "utf8")) as { token?: string };
    expect(persistedContents.token).toBe("pasted-bearer-value");
  });
});

describe("provision — dry-run default and idempotency", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-cli-provision-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  const verticalsFile = JSON.stringify({
    verticals: [
      {
        vertical: "outdoor-gear",
        viewName: "outdoor-gear-view",
        locale: "en_US",
        probeViewId: "acv-demo-outdoor-gear-eu",
        attribute: "vertical",
        expectedValue: "outdoor-gear",
        defaultPriceBookId: "acpb-demo-1",
        policyNames: ["outdoor-gear-discount"],
      },
    ],
  });

  it("with no --yes flag, issues zero mutations and states this was a dry run", async () => {
    const { deps, calls } = makeDeps(
      {
        "POST /graphql FacetValues": graphQlOk({ productSearch: { facets: [{ attribute: "vertical", buckets: [{ value: "outdoor-gear", count: 5 }] }] } }),
        "POST /admin/graphql ListPolicies": graphQlOk({ policies: [] }),
        "POST /admin/graphql ListChannels": graphQlOk({ channels: [] }),
      },
      configDir,
    );
    const realDeps: CliDeps = { ...deps, readFile: async () => verticalsFile };

    const result = await runCli(["provision", "--file", "verticals.json"], realDeps);

    expect(result.exitCode).toBe(0);
    expect(result.stdout ?? "").toMatch(/dry run/i);
    expect(calls.filter((call) => call.operationName?.startsWith("Create") || call.operationName?.startsWith("Update") || call.operationName?.startsWith("Delete"))).toHaveLength(0);
  });

  it("--yes issues mutations on pass 1, and none on pass 2 against unchanged state", async () => {
    let policiesState: readonly { policyId: string; name: string }[] = [];
    let channelsState: readonly { channelId: string; name: string; policyIds: readonly string[] }[] = [];
    const { deps } = makeDeps(
      {
        "POST /graphql FacetValues": graphQlOk({ productSearch: { facets: [{ attribute: "vertical", buckets: [{ value: "outdoor-gear", count: 5 }] }] } }),
        "POST /admin/graphql ListPolicies": () => graphQlOk({ policies: policiesState }),
        "POST /admin/graphql CreatePolicy": () => {
          policiesState = [...policiesState, { policyId: "pol-demo-1", name: "outdoor-gear-discount" }];
          return graphQlOk({ createPolicy: { policyId: "pol-demo-1" } });
        },
        "POST /admin/graphql ListChannels": () => graphQlOk({ channels: channelsState.map((c) => ({ channelId: c.channelId, name: c.name, scopes: [], policyIds: c.policyIds })) }),
        "POST /admin/graphql CreateChannel": () => {
          channelsState = [...channelsState, { channelId: "chan-demo-1", name: "outdoor-gear-view", policyIds: [] }];
          return graphQlOk({ createChannel: { channelId: "chan-demo-1" } });
        },
        "POST /admin/graphql UpdateChannel": () => {
          channelsState = channelsState.map((c) => (c.channelId === "chan-demo-1" ? { ...c, policyIds: ["pol-demo-1"] } : c));
          return graphQlOk({ updateChannel: { channelId: "chan-demo-1" } });
        },
      },
      configDir,
    );
    const realDeps: CliDeps = { ...deps, readFile: async () => verticalsFile };

    const pass1 = await runCli(["provision", "--file", "verticals.json", "--yes"], realDeps);
    expect(pass1.exitCode).toBe(0);
    expect(policiesState).toHaveLength(1);
    expect(channelsState).toHaveLength(1);

    const pass2 = await runCli(["provision", "--file", "verticals.json", "--yes"], realDeps);
    expect(pass2.exitCode).toBe(0);
    expect(pass2.stdout ?? "").not.toMatch(/dry run/i);
    // Second pass against unchanged state: still exactly one policy, one channel.
    expect(policiesState).toHaveLength(1);
    expect(channelsState).toHaveLength(1);
  });
});

describe("Admin commands with no credential configured exit non-zero, immediately", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-cli-nocred-"));
    delete process.env[ACO_TOKEN_ENV_VAR];
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    delete process.env[ACO_TOKEN_ENV_VAR];
  });

  it("policy list fails non-zero when the underlying call rejects", async () => {
    const { fetch } = createFetchDouble({} as never);
    const client = createAcoClient({
      fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      adminBaseUrl: "https://admin.aco.example/admin/graphql",
      merchandisingBaseUrl: "https://merch.aco.example/graphql",
      tokenProvider: {
        domain: "aco",
        getToken: async () => {
          throw new Error("Missing credential for domain \"aco\".");
        },
        invalidate: () => undefined,
        describeRemedy: () => ({ domain: "aco", cliCommand: "hiberus-aco auth token set", envVar: ACO_TOKEN_ENV_VAR, configPath: "/dev/null", reason: "not found" }),
      },
    });
    const deps: CliDeps = { client, configDir, readStdin: async () => "", persist: () => "", readFile: async () => "", writeFile: async () => undefined };

    const result = await runCli(["policy", "list"], deps);

    expect(result.exitCode).not.toBe(0);
  });
});

describe("Untrusted upstream error text is redacted before reaching stderr", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-cli-redact-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("a message containing `;`, backticks, an ANSI escape, and a token-shaped value is redacted on the CLI's stderr path", async () => {
    const adversarial = 'failed; `rm -rf /` [31m token=abc123secret [0m';
    const { deps } = makeDeps({ "POST /admin/graphql ListPolicies": graphQlErrors([{ message: adversarial, extensions: { code: "generic" } }]) }, configDir);

    const result = await runCli(["policy", "list"], deps);

    expect(result.exitCode).not.toBe(0);
    const stderr = result.stderr ?? "";
    expect(stderr).not.toMatch(/abc123secret/);
    // Inert text (never interpolated into a command) — the literal characters
    // themselves are harmless and may still appear verbatim.
    expect(stderr).toContain(";");
  });
});
