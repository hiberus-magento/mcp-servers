// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 2.5): `ListPolicies` is a named admin query
// (exploration.md, `Q_POLICIES`). The response fixture (tasks.md 2.20) lives
// in `packages/aco/fixtures/policies.json`, synthetic values only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Kind, parse, visit, type FieldNode } from "graphql";
import { describe, expect, it } from "vitest";
import { createFetchDouble, graphQlOk } from "../../testing/fetch-double.js";
import { createAdminTransport } from "../http.js";
import { listPolicies } from "./policies.js";

const POLICIES_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/policies.json", import.meta.url)), "utf8")) as {
  readonly policies: readonly {
    readonly policyId: string;
    readonly name: string;
    readonly mandatory: boolean;
    readonly actions: readonly {
      readonly triggers: readonly { readonly name: string; readonly transportType: string }[];
      readonly filters: readonly { readonly attribute: string; readonly values: readonly string[]; readonly value?: string; readonly enabled: boolean; readonly actionFilterOperator: string; readonly valueSource: string }[];
    }[];
  }[];
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

/** The field names selected directly under the first `parentField` in the document. */
function selectionUnder(document: string, parentField: string): string[] {
  let names: string[] = [];
  visit(parse(document), {
    Field: (node) => {
      if (node.name.value === parentField && names.length === 0) {
        names = (node.selectionSet?.selections ?? []).filter((selection): selection is FieldNode => selection.kind === Kind.FIELD).map((selection) => selection.name.value);
      }
    },
  });
  return names;
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

  /**
   * `PolicyResponse` has `policyId`, `name`, `mandatory` and `actions` and
   * NOTHING else — no `enabled`, `active`, `status`, `isEnabled`, `state`
   * or `disabled`. The document used to request a policy-level `enabled`
   * "defensively"; the live service answers `Cannot query field "enabled"
   * on type "PolicyResponse"`, which kills the whole query, so this
   * operation returned nothing at all in production. The nested
   * `filters { enabled }` is a different field on a different type and is
   * real — the exact selection is asserted so neither can drift into the
   * other.
   */
  it("selects only the fields PolicyResponse actually has, and keeps the filter-level `enabled` that is real", async () => {
    const { fetch, calls } = createFetchDouble({
      "POST /admin/graphql ListPolicies": graphQlOk(POLICIES_FIXTURE),
    });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    await listPolicies(transport);

    const document = (JSON.parse(calls[0]?.body ?? "{}") as { readonly query?: string }).query ?? "";
    expect(selectionUnder(document, "policies")).toEqual(["policyId", "name", "mandatory", "actions"]);
    expect(selectionUnder(document, "filters")).toContain("enabled");
  });

  // CHANGED DELIBERATELY — two tests removed here, not weakened:
  //
  //   - "round-trips an `enabled` key when one is present in the response
  //     payload (parser tolerance only)" and
  //   - "resolves `enabled` to undefined when Adobe's schema does not
  //     return it".
  //
  // Both exercised `PolicyResult.enabled`, an optional field kept alive
  // solely so the frozen `aco_toggle_policy` could read it. That tool is
  // gone (`aco_toggle_policy_filter` operates on a FILTER's `enabled`,
  // which is real), the field is gone with it, and a test that feeds a
  // parser a key no wire shape can produce proves nothing about the wire.
  // The filter-level `enabled` is covered by the round-trip assertions
  // below and in `tools/aco-tools.test.ts`.

  /**
   * `actions` used to be passed through as an opaque `unknown[]`. It is the
   * payload of a read-modify-write now: `updatePolicy` REPLACES the policy,
   * so every field the read drops is destroyed on the next write. The whole
   * tree is therefore narrowed field by field, and this asserts it survives
   * the parse intact.
   */
  it("narrows the whole actions tree — triggers and filters, field for field", async () => {
    const { fetch } = createFetchDouble({ "POST /admin/graphql ListPolicies": graphQlOk(POLICIES_FIXTURE) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    const result = await listPolicies(transport);

    const action = result.policies[0]?.actions?.[0];
    expect(action?.triggers).toEqual(POLICIES_FIXTURE.policies[0]?.actions[0]?.triggers);
    expect(action?.filters).toEqual(POLICIES_FIXTURE.policies[0]?.actions[0]?.filters);
    expect(action?.filters?.[0]?.enabled).toBe(true);
    expect(action?.filters?.[1]?.enabled).toBe(false);
  });

  /**
   * The read is one half of the round trip, so its selection must cover
   * every field `UpdatePolicyRequest` accepts — a field the read omits is a
   * field the write destroys. `value` (singular) is selected but
   * deliberately NOT written back; `policy-update.ts` records why.
   */
  it("selects every filter field the update mutation's input accepts", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql ListPolicies": graphQlOk(POLICIES_FIXTURE) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    await listPolicies(transport);

    const document = (JSON.parse(calls[0]?.body ?? "{}") as { readonly query?: string }).query ?? "";
    expect(selectionUnder(document, "filters").sort()).toEqual(["actionFilterOperator", "attribute", "enabled", "value", "valueSource", "values"]);
    expect(selectionUnder(document, "triggers").sort()).toEqual(["name", "transportType"]);
  });
});
