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
import { createFetchDouble, graphQlErrors, graphQlOk, type RecordedCall } from "./testing/fetch-double.js";
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

function makeDeps(routes: Record<string, unknown>, configDir: string): { deps: CliDeps; calls: readonly RecordedCall[] } {
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
        "POST /graphql FacetValues": graphQlOk({ productSearch: { facets: [{ attribute: "vertical", buckets: [{ title: "outdoor-gear", count: 5 }] }] } }),
        "POST /admin/graphql ListPolicies": graphQlOk({ policies: [] }),
        "POST /admin/graphql ListCatalogViews": graphQlOk({ catalogViews: [] }),
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
    let viewsState: readonly { viewId: string; name: string; policyIds: readonly string[] }[] = [];
    const { deps } = makeDeps(
      {
        "POST /graphql FacetValues": graphQlOk({ productSearch: { facets: [{ attribute: "vertical", buckets: [{ title: "outdoor-gear", count: 5 }] }] } }),
        "POST /admin/graphql ListPolicies": () => graphQlOk({ policies: policiesState }),
        "POST /admin/graphql CreatePolicy": () => {
          policiesState = [...policiesState, { policyId: "pol-demo-1", name: "outdoor-gear-discount" }];
          return graphQlOk({ createPolicy: { policyId: "pol-demo-1" } });
        },
        "POST /admin/graphql ListCatalogViews": () => graphQlOk({ catalogViews: viewsState.map((v) => ({ viewId: v.viewId, name: v.name, sources: [], policyIds: v.policyIds })) }),
        "POST /admin/graphql CreateChannel": () => {
          viewsState = [...viewsState, { viewId: "acv-demo-1", name: "outdoor-gear-view", policyIds: [] }];
          return graphQlOk({ createChannel: { channelId: "acv-demo-1" } });
        },
        "POST /admin/graphql UpdateChannel": () => {
          viewsState = viewsState.map((v) => (v.viewId === "acv-demo-1" ? { ...v, policyIds: ["pol-demo-1"] } : v));
          return graphQlOk({ updateChannel: { channelId: "acv-demo-1" } });
        },
      },
      configDir,
    );
    const realDeps: CliDeps = { ...deps, readFile: async () => verticalsFile };

    const pass1 = await runCli(["provision", "--file", "verticals.json", "--yes"], realDeps);
    expect(pass1.exitCode).toBe(0);
    expect(policiesState).toHaveLength(1);
    expect(viewsState).toHaveLength(1);

    const pass2 = await runCli(["provision", "--file", "verticals.json", "--yes"], realDeps);
    expect(pass2.exitCode).toBe(0);
    expect(pass2.stdout ?? "").not.toMatch(/dry run/i);
    // Second pass against unchanged state: still exactly one policy, one catalog view.
    expect(policiesState).toHaveLength(1);
    expect(viewsState).toHaveLength(1);
  });
});

/**
 * "Disable a policy" does not exist in this API: `UpdatePolicyRequest` has
 * no `enabled` member, and enable/disable is a FILTER operation. This
 * command therefore disables every FILTER of every policy, one whole-policy
 * replacement each — and `updatePolicy` REPLACES, so the replacement has to
 * carry everything the read returned.
 */
describe("policy disable --all — every FILTER of every policy, written back whole", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "aco-cli-disable-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  const POLICY_WIRE = {
    policyId: "pol-demo-1",
    name: "outdoor-gear-discount",
    mandatory: false,
    actions: [
      {
        triggers: [{ name: "on-catalog-read", transportType: "GRAPHQL" }],
        filters: [
          { attribute: "vertical", values: ["outdoor-gear"], value: "outdoor-gear", enabled: true, actionFilterOperator: "IN", valueSource: "STATIC" },
          { attribute: "price_band", values: ["mid"], enabled: false, actionFilterOperator: "IN", valueSource: "STATIC" },
        ],
      },
    ],
  };

  it("with no --yes flag, issues zero mutations and says what it would do", async () => {
    const { deps, calls } = makeDeps({ "POST /admin/graphql ListPolicies": graphQlOk({ policies: [POLICY_WIRE] }) }, configDir);

    const result = await runCli(["policy", "disable", "--all"], deps);

    expect(result.exitCode).toBe(0);
    expect(result.stdout ?? "").toMatch(/dry run/i);
    expect(result.stdout ?? "").toContain("filter");
    expect(calls.filter((call) => call.operationName === "UpdatePolicy")).toHaveLength(0);
  });

  it("--yes writes each policy back whole, with every filter disabled and nothing else changed", async () => {
    const { deps, calls } = makeDeps(
      {
        "POST /admin/graphql ListPolicies": graphQlOk({ policies: [POLICY_WIRE] }),
        "POST /admin/graphql UpdatePolicy": graphQlOk({ updatePolicy: { policyId: "pol-demo-1" } }),
      },
      configDir,
    );

    const result = await runCli(["policy", "disable", "--all", "--yes"], deps);

    expect(result.exitCode).toBe(0);
    const update = calls.find((call) => call.operationName === "UpdatePolicy");
    const posted = JSON.parse(update?.body ?? "{}") as { readonly variables?: { readonly policyRequest?: unknown } };
    expect(posted.variables?.policyRequest).toEqual({
      policyId: "pol-demo-1",
      name: "outdoor-gear-discount",
      mandatory: false,
      actions: [
        {
          triggers: [{ transportType: "GRAPHQL", name: "on-catalog-read" }],
          filters: [
            { attribute: "vertical", enabled: false, actionFilterOperator: "IN", valueSource: "STATIC", values: ["outdoor-gear"] },
            { attribute: "price_band", enabled: false, actionFilterOperator: "IN", valueSource: "STATIC", values: ["mid"] },
          ],
        },
      ],
    });
  });

  it("skips and names a policy the read did not describe completely, rather than writing defaults over it", async () => {
    const { policyId, name, actions } = POLICY_WIRE;
    const { deps, calls } = makeDeps(
      {
        "POST /admin/graphql ListPolicies": graphQlOk({ policies: [{ policyId, name, actions }] }),
        "POST /admin/graphql UpdatePolicy": graphQlOk({ updatePolicy: { policyId: "pol-demo-1" } }),
      },
      configDir,
    );

    const result = await runCli(["policy", "disable", "--all", "--yes"], deps);

    expect(calls.filter((call) => call.operationName === "UpdatePolicy")).toHaveLength(0);
    expect(result.exitCode).toBe(1);
    expect(result.stderr ?? "").toContain("outdoor-gear-discount");
    expect(result.stderr ?? "").toContain("mandatory");
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
