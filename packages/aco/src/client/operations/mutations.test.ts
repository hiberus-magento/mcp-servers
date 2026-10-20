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
import { selectionOf } from "../../testing/operation-documents.js";
import { createAdminTransport } from "../http.js";
import {
  ADMIN_MUTATION_NAMES,
  createCatalogView,
  createPolicy,
  deleteCatalogView,
  deletePolicy,
  updateCatalogView,
  updatePolicy,
  type CreateCatalogViewInput,
  type UpdateCatalogViewInput,
} from "./mutations.js";

const CLIENT_DIR = fileURLToPath(new URL("../../client/", import.meta.url));
const MUTATION_TOKEN = "mutation ";

// The six mutation-response fixtures (tasks.md 2.20) live in
// `packages/aco/fixtures/mutations.json`, synthetic values only. The three
// catalog-view entries mirror the responses the ACO Admin UI's own
// create/update/delete returned, including `defaultPriceBookId: null` and
// `deleteCatalogView`'s bare String.
const MUTATIONS_FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL("../../../fixtures/mutations.json", import.meta.url)), "utf8")) as {
  readonly createCatalogView: { readonly createCatalogView: { readonly viewId: string } };
  readonly updateCatalogView: { readonly updateCatalogView: { readonly viewId: string } };
  readonly deleteCatalogView: { readonly deleteCatalogView: string };
  readonly createPolicy: { readonly createPolicy: { readonly policyId: string } };
  readonly updatePolicy: { readonly updatePolicy: { readonly policyId: string } };
  readonly deletePolicy: { readonly deletePolicy: { readonly policyId: string } };
};

/** The selection set all three captured catalog-view requests ask for. */
const CAPTURED_VIEW_SELECTION = [
  "viewId",
  "name",
  "sources",
  "policyIds",
  "restrictedAccessKeyIds",
  "protectionEnabled",
  "defaultPriceBookId",
  "allowedPriceBookIds",
  "createdAt",
  "updatedAt",
  "draft",
  "layers",
];

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
  // CHANGED DELIBERATELY: was `createChannel`/`updateChannel`/`deleteChannel`.
  // Those three field names no longer exist on the admin schema — the same
  // rename that moved `Query.channels` to `Query.catalogViews` moved the
  // write side with it, and the replacements below were captured from the
  // ACO Admin UI's own successful requests.
  it("is a closed 6-member list", () => {
    expect([...ADMIN_MUTATION_NAMES].sort()).toEqual(["createCatalogView", "createPolicy", "deleteCatalogView", "deletePolicy", "updateCatalogView", "updatePolicy"]);
  });

  it("names no retired channel mutation", () => {
    expect([...ADMIN_MUTATION_NAMES].filter((name) => /channel/i.test(name))).toEqual([]);
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

function postedBody(body: string | undefined): { readonly query: string; readonly variables: Record<string, unknown> } {
  const parsed = JSON.parse(body ?? "{}") as { readonly query?: string; readonly variables?: Record<string, unknown> };
  return { query: parsed.query ?? "", variables: parsed.variables ?? {} };
}

/**
 * The three catalog-view writes, asserted against the ACO Admin UI's own
 * captured requests — document text AND variables, never only the parsed
 * response. The fetch double routes on the operation NAME extracted from
 * the body and never reads the rest, so a document that re-grew
 * `createChannel` would satisfy a response-shaped assertion unchanged.
 */
describe("the three catalog-view mutations", () => {
  const CREATE_INPUT: CreateCatalogViewInput = {
    name: "outdoor_gear_eu_en",
    sources: [{ locale: "en_US" }],
    policyIds: [],
    restrictedAccessKeyIds: [],
    protectionEnabled: false,
    allowedPriceBookIds: [],
    draft: false,
    layers: [],
  };

  const UPDATE_INPUT: UpdateCatalogViewInput = {
    viewId: MUTATIONS_FIXTURE.updateCatalogView.updateCatalogView.viewId,
    name: "outdoor_gear_eu_en",
    sources: [{ locale: "en_US" }],
    policyIds: [],
    restrictedAccessKeyIds: [],
    protectionEnabled: false,
    defaultPriceBookId: "",
    allowedPriceBookIds: [],
    draft: true,
    layers: [],
  };

  it("createCatalogView posts the captured document and exactly the members CreateCatalogViewRequest declares", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql CreateCatalogView": graphQlOk(MUTATIONS_FIXTURE.createCatalogView) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    const result = await createCatalogView(transport, CREATE_INPUT);

    expect(calls[0]?.operationName).toBe("CreateCatalogView");
    const posted = postedBody(calls[0]?.body);
    expect(posted.query).toContain("$viewRequest: CreateCatalogViewRequest!");
    expect(posted.query).not.toMatch(/\bcreateChannel\b/);
    expect(selectionOf(posted.query, "createCatalogView").fields).toEqual(CAPTURED_VIEW_SELECTION);
    expect(posted.variables).toEqual({ viewRequest: CREATE_INPUT });
    expect(result.viewId).toBe(MUTATIONS_FIXTURE.createCatalogView.createCatalogView.viewId);
  });

  /**
   * `CreateCatalogViewRequest` has no `defaultPriceBookId` — which is why
   * provisioning a fully-configured view is TWO calls. An input member the
   * request type does not declare fails the whole mutation, so the
   * projection must drop it rather than pass the caller's object along.
   */
  it("never sends defaultPriceBookId on the create, even when the caller holds one", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql CreateCatalogView": graphQlOk(MUTATIONS_FIXTURE.createCatalogView) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    await createCatalogView(transport, { ...CREATE_INPUT, defaultPriceBookId: "acpb-demo-eur" } as never);

    const viewRequest = postedBody(calls[0]?.body).variables["viewRequest"] as Record<string, unknown>;
    expect(Object.keys(viewRequest).sort()).toEqual(["allowedPriceBookIds", "draft", "layers", "name", "policyIds", "protectionEnabled", "restrictedAccessKeyIds", "sources"]);
  });

  it("updateCatalogView posts the captured document and the WHOLE view in one $viewRequest", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql UpdateCatalogView": graphQlOk(MUTATIONS_FIXTURE.updateCatalogView) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    await updateCatalogView(transport, UPDATE_INPUT);

    expect(calls[0]?.operationName).toBe("UpdateCatalogView");
    const posted = postedBody(calls[0]?.body);
    expect(posted.query).toContain("$viewRequest: UpdateCatalogViewRequest!");
    expect(posted.query).not.toMatch(/\bupdateChannel\b/);
    expect(selectionOf(posted.query, "updateCatalogView").fields).toEqual(CAPTURED_VIEW_SELECTION);
    expect(posted.variables).toEqual({ viewRequest: UPDATE_INPUT });
  });

  /**
   * `updateCatalogView` REPLACES the view it is given, exactly as
   * `updatePolicy` replaces a policy. A spread would post whatever the
   * caller happened to be holding — a `createdAt` read back off a previous
   * response is the concrete case — and one undeclared member of
   * `UpdateCatalogViewRequest` fails the whole write.
   */
  it("posts only the ten members UpdateCatalogViewRequest declares — never a response-only field", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql UpdateCatalogView": graphQlOk(MUTATIONS_FIXTURE.updateCatalogView) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    await updateCatalogView(transport, { ...UPDATE_INPUT, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } as never);

    const viewRequest = postedBody(calls[0]?.body).variables["viewRequest"] as Record<string, unknown>;
    expect(Object.keys(viewRequest).sort()).toEqual([
      "allowedPriceBookIds",
      "defaultPriceBookId",
      "draft",
      "layers",
      "name",
      "policyIds",
      "protectionEnabled",
      "restrictedAccessKeyIds",
      "sources",
      "viewId",
    ]);
  });

  /**
   * `deleteCatalogView` returns a bare `String` — the deleted id — not an
   * object, so it has no selection set at all. A document that asked for
   * one would be rejected by every GraphQL server, and a parser that read
   * `.viewId` off a string would silently return `undefined` forever.
   */
  it("deleteCatalogView posts $viewId: String!, selects nothing, and reports the id the server returned", async () => {
    const { fetch, calls } = createFetchDouble({ "POST /admin/graphql DeleteCatalogView": graphQlOk(MUTATIONS_FIXTURE.deleteCatalogView) });
    const transport = createAdminTransport({ fetch, now: FIXED_NOW, sleep: NOOP_SLEEP, baseUrl: "https://admin.aco.example/admin/graphql", tokenProvider: stubTokenProvider() });

    const result = await deleteCatalogView(transport, { viewId: MUTATIONS_FIXTURE.deleteCatalogView.deleteCatalogView });

    expect(calls[0]?.operationName).toBe("DeleteCatalogView");
    const posted = postedBody(calls[0]?.body);
    expect(posted.query).toContain("$viewId: String!");
    expect(posted.query).not.toMatch(/\bdeleteChannel\b/);
    expect(selectionOf(posted.query, "deleteCatalogView").fields).toEqual([]);
    expect(posted.variables).toEqual({ viewId: MUTATIONS_FIXTURE.deleteCatalogView.deleteCatalogView });
    expect(result.deletedViewId).toBe(MUTATIONS_FIXTURE.deleteCatalogView.deleteCatalogView);
  });
});

describe("the three policy mutations", () => {
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
