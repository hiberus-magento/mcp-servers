// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.5): `ListPolicies` is a named admin query
// (exploration.md, `Q_POLICIES`). The response fixture (tasks.md 2.20) lives
// in `packages/aco/fixtures/policies.json`, synthetic values only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlOk } from "../../testing/fetch-double.js";
import { createAdminTransport } from "../http.js";
import { listPolicies } from "./policies.js";

const POLICIES_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/policies.json", import.meta.url)), "utf8")) as {
  readonly policies: readonly { readonly policyId: string; readonly name: string; readonly mandatory: boolean; readonly actions: readonly unknown[] }[];
};

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

describe("listPolicies", () => {
  it("issues the named ListPolicies query and returns policyId/name-keyed rows", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /admin/graphql ListPolicies": graphQlOk(POLICIES_FIXTURE),
    });
    const transport = createAdminTransport({
      fetch,
      now: FIXED_NOW,
      sleep: NOOP_SLEEP,
      baseUrl: "https://admin.aco.example/admin/graphql",
      tokenProvider: stubTokenProvider(),
    });

    const result = await listPolicies(transport);

    expect(result.policies).toEqual(POLICIES_FIXTURE.policies);
    expect(calls[0]?.operationName).toBe("ListPolicies");
  });

  it("round-trips an `enabled` field when Adobe's schema returns it (tasks.md 5.7/5.8 — requested defensively, not in the canonical fixture)", async () => {
    const { fetch } = createFetchDouble({
      "POST /admin/graphql ListPolicies": graphQlOk({ policies: [{ policyId: "pol-demo-2", name: "home-decor-discount", mandatory: false, actions: [], enabled: true }] }),
    });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    const result = await listPolicies(transport);

    expect(result.policies[0]?.enabled).toBe(true);
  });

  it("resolves `enabled` to undefined when Adobe's schema does not return it (the canonical fixture's own shape)", async () => {
    const { fetch } = createFetchDouble({ "POST /admin/graphql ListPolicies": graphQlOk(POLICIES_FIXTURE) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    const result = await listPolicies(transport);

    expect(result.policies[0]?.enabled).toBeUndefined();
  });
});
