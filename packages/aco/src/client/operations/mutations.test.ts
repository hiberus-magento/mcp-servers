// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.10): `client/operations/mutations.ts` is the ONLY
// module under `client/` that builds a mutation document — a source scan
// asserts the token `mutation ` appears nowhere else, so a seventh mutation
// anywhere else in the tree is a named, reviewable diff caught by this test
// (design.md, Decision 4). `ADMIN_MUTATION_NAMES` is a closed 6-member list
// backing `AdminMutationName`.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlOk } from "../../testing/fetch-double.js";
import { createAdminTransport } from "../http.js";
import { ADMIN_MUTATION_NAMES, createChannel, createPolicy, deleteChannel, deletePolicy, updateChannel, updatePolicy } from "./mutations.js";

const CLIENT_DIR = fileURLToPath(new URL("../../client/", import.meta.url));
const MUTATION_TOKEN = "mutation ";

// The six mutation-response fixtures (tasks.md 2.20) live in
// `packages/aco/fixtures/mutations.json`, synthetic values only.
const MUTATIONS_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/mutations.json", import.meta.url)), "utf8")) as {
  readonly createChannel: { readonly createChannel: { readonly channelId: string } };
  readonly updateChannel: { readonly updateChannel: { readonly channelId: string } };
  readonly deleteChannel: { readonly deleteChannel: { readonly channelId: string } };
  readonly createPolicy: { readonly createPolicy: { readonly policyId: string } };
  readonly updatePolicy: { readonly updatePolicy: { readonly policyId: string } };
  readonly deletePolicy: { readonly deletePolicy: { readonly policyId: string } };
};

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(`${full}/`));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts") || entry.name.endsWith(".test-d.ts")) {
      continue;
    }
    files.push(full);
  }
  return files;
}

describe("client/ — `mutation ` token source scan", () => {
  it("appears only in operations/mutations.ts", () => {
    const offenders: string[] = [];
    for (const file of listSourceFiles(CLIENT_DIR)) {
      const text = readFileSync(file, "utf8");
      if (text.includes(MUTATION_TOKEN) && !file.endsWith("operations/mutations.ts")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("ADMIN_MUTATION_NAMES", () => {
  it("is a closed 6-member list", () => {
    expect([...ADMIN_MUTATION_NAMES].sort()).toEqual(["createChannel", "createPolicy", "deleteChannel", "deletePolicy", "updateChannel", "updatePolicy"]);
  });
});

const NOOP_SLEEP = async (): Promise<void> => undefined;
const FIXED_NOW = (): number => 0;

function stubTokenProvider() {
  return {
    domain: "aco",
    getToken: async () => ({ kind: "static" as const, value: "test-only-bearer" }),
    invalidate: () => undefined,
    describeRemedy: () => ({ domain: "aco", cliCommand: "hiberus-aco auth token set", envVar: "ACO_TOKEN", configPath: "/dev/null", reason: "not found" }),
  };
}

describe("the six admin mutations", () => {
  it("createChannel issues the named CreateChannel mutation", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql CreateChannel": graphQlOk(MUTATIONS_FIXTURE.createChannel) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    const result = await createChannel(transport, { name: "outdoor_gear_eu_en", locale: "en_US" });

    expect(result.channelId).toBe(MUTATIONS_FIXTURE.createChannel.createChannel.channelId);
    expect(calls[0]?.operationName).toBe("CreateChannel");
  });

  it("updateChannel issues the named UpdateChannel mutation", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql UpdateChannel": graphQlOk(MUTATIONS_FIXTURE.updateChannel) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    await updateChannel(transport, { channelId: MUTATIONS_FIXTURE.updateChannel.updateChannel.channelId, defaultPriceBookId: "acpb-demo-eur" });

    expect(calls[0]?.operationName).toBe("UpdateChannel");
  });

  it("deleteChannel issues the named DeleteChannel mutation", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql DeleteChannel": graphQlOk(MUTATIONS_FIXTURE.deleteChannel) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    await deleteChannel(transport, { channelId: MUTATIONS_FIXTURE.deleteChannel.deleteChannel.channelId });

    expect(calls[0]?.operationName).toBe("DeleteChannel");
  });

  it("createPolicy issues the named CreatePolicy mutation", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql CreatePolicy": graphQlOk(MUTATIONS_FIXTURE.createPolicy) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    const result = await createPolicy(transport, { name: "outdoor-gear-discount" });

    expect(result.policyId).toBe(MUTATIONS_FIXTURE.createPolicy.createPolicy.policyId);
    expect(calls[0]?.operationName).toBe("CreatePolicy");
  });

  // CHANGED DELIBERATELY: this call used to be
  // `updatePolicy(transport, { policyId, enabled: false })`.
  // `UpdatePolicyRequest` has no `enabled` member — sending one is a
  // validation error that executes nothing — and there is no policy-level
  // enable/disable in this API at all. The mutation carries the WHOLE
  // policy, exactly as the ACO Admin UI's own Save does.
  const FULL_POLICY_INPUT = {
    policyId: MUTATIONS_FIXTURE.updatePolicy.updatePolicy.policyId,
    name: "outdoor-gear-discount",
    mandatory: false,
    actions: [
      {
        triggers: [{ transportType: "GRAPHQL", name: "on-catalog-read" }],
        filters: [{ attribute: "vertical", enabled: false, actionFilterOperator: "IN", valueSource: "STATIC", values: ["outdoor-gear"] }],
      },
    ],
  } as const;

  it("updatePolicy issues the named UpdatePolicy mutation, carrying the whole policy in one $policyRequest variable", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql UpdatePolicy": graphQlOk(MUTATIONS_FIXTURE.updatePolicy) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    await updatePolicy(transport, FULL_POLICY_INPUT);

    expect(calls[0]?.operationName).toBe("UpdatePolicy");
    const posted = JSON.parse(calls[0]?.body ?? "{}") as { readonly query?: string; readonly variables?: Readonly<Record<string, unknown>> };
    expect(posted.query ?? "").toContain("$policyRequest: UpdatePolicyRequest!");
    expect(posted.variables).toEqual({ policyRequest: FULL_POLICY_INPUT });
  });

  /**
   * The variables are built field by field, never spread from the input: a
   * spread would put whatever the caller happens to be holding onto the
   * wire, and an unknown member of `UpdatePolicyRequest` is a validation
   * error that executes nothing. The singular `value` our read selects is
   * the concrete case — it must not reach the write.
   */
  it("posts only the five filter fields the input accepts — never the singular `value`", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql UpdatePolicy": graphQlOk(MUTATIONS_FIXTURE.updatePolicy) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    await updatePolicy(transport, { ...FULL_POLICY_INPUT, actions: [{ ...FULL_POLICY_INPUT.actions[0], filters: [{ ...FULL_POLICY_INPUT.actions[0].filters[0], value: "outdoor-gear" } as never] }] });

    const body = calls[0]?.body ?? "";
    expect(body).not.toContain('"value"');
    const posted = JSON.parse(body) as { readonly variables: { readonly policyRequest: { readonly actions: readonly { readonly filters: readonly Record<string, unknown>[] }[] } } };
    expect(Object.keys(posted.variables.policyRequest.actions[0]?.filters[0] ?? {}).sort()).toEqual(["actionFilterOperator", "attribute", "enabled", "valueSource", "values"]);
  });

  it("deletePolicy issues the named DeletePolicy mutation", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql DeletePolicy": graphQlOk(MUTATIONS_FIXTURE.deletePolicy) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    await deletePolicy(transport, { policyId: MUTATIONS_FIXTURE.deletePolicy.deletePolicy.policyId });

    expect(calls[0]?.operationName).toBe("DeletePolicy");
  });
});
