// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The six admin mutations: `createCatalogView`/`updateCatalogView`/
// `deleteCatalogView` and `createPolicy`/`updatePolicy`/`deletePolicy`. This
// is the ONLY module under `client/` allowed to contain the token
// `mutation ` — a source-scan test in `mutations.test.ts` enforces it, so a
// seventh mutation anywhere else in the tree is a named, reviewable diff.
// Every mutation declares `idempotent: false` (design.md, Decision 4): a
// misclassified throttle can never replay a write, and `client/index.ts`'s
// factory reads this field to drive `retry.ts`.
//
// CHANGED DELIBERATELY: the first three were `createChannel`/
// `updateChannel`/`deleteChannel`, taking loose `channelId`/`locale`/
// `policyIds` arguments. Those field names do not exist — the same upstream
// rename that moved `Query.channels` to `Query.catalogViews`
// (`catalog-views.ts`) moved the write side with it. The three documents
// below are the ACO Admin UI's own requests, captured verbatim from
// successful calls, down to the argument names, the request types and the
// selection sets. Only the operation NAMES are ours (`CreateCatalogView`
// rather than the UI's `CREATE_CATALOG_VIEW`), matching every other
// document in this package; an operation name is client-chosen and never
// reaches the schema.
//
// Three properties of those captures are load-bearing:
//
//   - `CreateCatalogViewRequest` has NO `defaultPriceBookId`. Creating a
//     fully-configured view is deliberately TWO calls — create, then update
//     — never one.
//   - `UpdateCatalogViewRequest` REPLACES the view it is given, exactly as
//     `UpdatePolicyRequest` replaces a policy. Every member it declares is
//     required here for that reason: a caller that cannot supply one is a
//     caller about to destroy it, and `provision.ts` refuses rather than
//     defaults. The UI sends `defaultPriceBookId: ""` for "none" and the
//     response comes back `null`.
//   - `deleteCatalogView` returns a bare `String` — the deleted id — not an
//     object, so its document carries no selection set.
import { AcoSchemaMismatchError } from "../errors.js";
import type { AdminTransport } from "../http.js";

export const ADMIN_MUTATION_NAMES = ["createCatalogView", "updateCatalogView", "deleteCatalogView", "createPolicy", "updatePolicy", "deletePolicy"] as const;

export type AdminMutationName = (typeof ADMIN_MUTATION_NAMES)[number];

/** A view's own source. `locale` is its only confirmed member, as on the read side. */
export interface CatalogViewSourceInput {
  readonly locale: string;
}

export interface CatalogViewLayerSourceInput {
  readonly locale: string;
  readonly layer: string;
}

export interface CatalogViewLayerInput {
  readonly order: number;
  readonly source: CatalogViewLayerSourceInput;
}

/** The members both request types share, in the order the captured requests send them. */
export interface CatalogViewMutationFields {
  readonly name: string;
  readonly sources: readonly CatalogViewSourceInput[];
  readonly policyIds: readonly string[];
  readonly restrictedAccessKeyIds: readonly string[];
  readonly protectionEnabled: boolean;
  readonly allowedPriceBookIds: readonly string[];
  readonly draft: boolean;
  readonly layers: readonly CatalogViewLayerInput[];
}

/** `CreateCatalogViewRequest` — the shared members and nothing else. */
export type CreateCatalogViewInput = CatalogViewMutationFields;

export interface CreateCatalogViewResult {
  readonly viewId: string;
}

/** `UpdateCatalogViewRequest` — the shared members plus `viewId` and `defaultPriceBookId`. */
export interface UpdateCatalogViewInput extends CatalogViewMutationFields {
  readonly viewId: string;
  /** `""` means "no default price book" — that is what the Admin UI sends. */
  readonly defaultPriceBookId: string;
}

export interface DeleteCatalogViewInput {
  readonly viewId: string;
}

export interface DeleteCatalogViewResult {
  /** The id the server reports it deleted. `deleteCatalogView` resolves to a bare `String`. */
  readonly deletedViewId: string;
}

// The selection set is the captured one, verbatim, including the
// response-only `createdAt`/`updatedAt`. Nothing here reads most of it —
// `updatePolicy` selects a whole policy and parses nothing for the same
// reason: the request that is known to work is the request we send.
//
// It is written out once per document rather than interpolated from a
// shared constant: the document collector in
// `testing/operation-documents.ts` reads these template literals out of the
// SOURCE, so an interpolation would hand `document-validity.test.ts` a
// `${...}` to parse and the scan would lose both documents. The two copies
// are pinned against each other by `mutations.test.ts`.
const CREATE_CATALOG_VIEW_DOCUMENT = `mutation CreateCatalogView($viewRequest: CreateCatalogViewRequest!) {
  createCatalogView(viewRequest: $viewRequest) {
    viewId
    name
    sources {
      locale
    }
    policyIds
    restrictedAccessKeyIds
    protectionEnabled
    defaultPriceBookId
    allowedPriceBookIds
    createdAt
    updatedAt
    draft
    layers {
      order
      source {
        locale
        layer
      }
    }
  }
}`;

/**
 * Built member by member, never spread — the same rule `updatePolicy`
 * carries. A spread posts whatever the caller happens to be holding,
 * including a `defaultPriceBookId` this request type does not declare, and
 * one undeclared member fails the whole mutation.
 */
function toViewRequest(input: CatalogViewMutationFields): Record<string, unknown> {
  return {
    name: input.name,
    sources: input.sources.map((source) => ({ locale: source.locale })),
    policyIds: [...input.policyIds],
    restrictedAccessKeyIds: [...input.restrictedAccessKeyIds],
    protectionEnabled: input.protectionEnabled,
    allowedPriceBookIds: [...input.allowedPriceBookIds],
    draft: input.draft,
    layers: input.layers.map((layer) => ({ order: layer.order, source: { locale: layer.source.locale, layer: layer.source.layer } })),
  };
}

export async function createCatalogView(transport: AdminTransport, input: CreateCatalogViewInput): Promise<CreateCatalogViewResult> {
  return transport.execute({
    track: "admin",
    document: CREATE_CATALOG_VIEW_DOCUMENT,
    variables: { viewRequest: toViewRequest(input) },
    idempotent: false,
    parse: (data) => {
      const record = data as { readonly createCatalogView?: { readonly viewId?: unknown } };
      const viewId = record.createCatalogView?.viewId;
      if (typeof viewId !== "string") {
        // Keyed: the mandatory follow-up update is addressed by it, and a
        // `""` placeholder would send that update at nothing.
        throw new AcoSchemaMismatchError({ operationName: "CreateCatalogView", fieldPath: "createCatalogView.viewId" });
      }
      return { viewId };
    },
  });
}

const UPDATE_CATALOG_VIEW_DOCUMENT = `mutation UpdateCatalogView($viewRequest: UpdateCatalogViewRequest!) {
  updateCatalogView(viewRequest: $viewRequest) {
    viewId
    name
    sources {
      locale
    }
    policyIds
    restrictedAccessKeyIds
    protectionEnabled
    defaultPriceBookId
    allowedPriceBookIds
    createdAt
    updatedAt
    draft
    layers {
      order
      source {
        locale
        layer
      }
    }
  }
}`;

export async function updateCatalogView(transport: AdminTransport, input: UpdateCatalogViewInput): Promise<void> {
  await transport.execute({
    track: "admin",
    document: UPDATE_CATALOG_VIEW_DOCUMENT,
    variables: { viewRequest: { viewId: input.viewId, ...toViewRequest(input), defaultPriceBookId: input.defaultPriceBookId } },
    idempotent: false,
    parse: () => undefined,
  });
}

// No selection set: `deleteCatalogView` resolves to `String`, and a leaf
// field with a selection set is invalid against every GraphQL server.
const DELETE_CATALOG_VIEW_DOCUMENT = `mutation DeleteCatalogView($viewId: String!) {
  deleteCatalogView(viewId: $viewId)
}`;

export async function deleteCatalogView(transport: AdminTransport, input: DeleteCatalogViewInput): Promise<DeleteCatalogViewResult> {
  return transport.execute({
    track: "admin",
    document: DELETE_CATALOG_VIEW_DOCUMENT,
    variables: { viewId: input.viewId },
    idempotent: false,
    parse: (data) => {
      const record = data as { readonly deleteCatalogView?: unknown };
      if (typeof record.deleteCatalogView !== "string") {
        throw new AcoSchemaMismatchError({ operationName: "DeleteCatalogView", fieldPath: "deleteCatalogView" });
      }
      return { deletedViewId: record.deleteCatalogView };
    },
  });
}

export interface CreatePolicyInput {
  readonly name: string;
}

export interface CreatePolicyResult {
  readonly policyId: string;
}

const CREATE_POLICY_DOCUMENT = `mutation CreatePolicy($name: String!) {
  createPolicy(name: $name) {
    policyId
  }
}`;

export async function createPolicy(transport: AdminTransport, input: CreatePolicyInput): Promise<CreatePolicyResult> {
  return transport.execute({
    track: "admin",
    document: CREATE_POLICY_DOCUMENT,
    variables: { name: input.name },
    idempotent: false,
    parse: (data) => {
      const record = data as { readonly createPolicy?: { readonly policyId?: string } };
      return { policyId: record.createPolicy?.policyId ?? "" };
    },
  });
}

// `updatePolicy` takes ONE `UpdatePolicyRequest!` argument carrying the
// whole policy, and REPLACES what it is given: this document and its input
// type are the ACO Admin UI's own Save request, captured from a real
// successful call, not a shape inferred from the response.
//
// It used to be `updatePolicy(policyId:, enabled:)`. `UpdatePolicyRequest`
// has no `enabled` member — sending one is a validation error that executes
// nothing — and there is no policy-level enable/disable anywhere in this
// API: the Admin UI offers "View details" and "Delete" on a policy, and
// "Edit / Disable / Delete" on a FILTER. Disabling is therefore a
// read-modify-write of the whole policy with one filter's `enabled` flipped
// (`policy-update.ts` owns that projection).
//
// `createdAt`/`updatedAt` are response-only — selected because the captured
// request selects them, never sent.
export interface UpdatePolicyTriggerInput {
  readonly transportType: string;
  readonly name: string;
}

/**
 * Exactly the five members the captured request sends. There is no singular
 * `value` here on purpose: our read selects one, the UI's Save does not send
 * one, and an undeclared input member fails the whole mutation.
 */
export interface UpdatePolicyFilterInput {
  readonly attribute: string;
  readonly enabled: boolean;
  readonly actionFilterOperator: string;
  readonly valueSource: string;
  readonly values: readonly string[];
}

export interface UpdatePolicyActionInput {
  readonly triggers: readonly UpdatePolicyTriggerInput[];
  readonly filters: readonly UpdatePolicyFilterInput[];
}

export interface UpdatePolicyInput {
  readonly policyId: string;
  readonly name: string;
  readonly mandatory: boolean;
  readonly actions: readonly UpdatePolicyActionInput[];
}

const UPDATE_POLICY_DOCUMENT = `mutation UpdatePolicy($policyRequest: UpdatePolicyRequest!) {
  updatePolicy(policyRequest: $policyRequest) {
    policyId
    name
    mandatory
    createdAt
    updatedAt
    actions {
      triggers {
        transportType
        name
      }
      filters {
        attribute
        values
        enabled
        actionFilterOperator
        valueSource
      }
    }
  }
}`;

export async function updatePolicy(transport: AdminTransport, input: UpdatePolicyInput): Promise<void> {
  // Built member by member, never spread. A spread posts whatever the
  // caller happens to be holding — including the singular `value` the read
  // carries — and one undeclared member of `UpdatePolicyRequest` fails the
  // whole mutation. The narrow input type documents the shape; this
  // projection is what actually enforces it on the wire.
  const policyRequest = {
    policyId: input.policyId,
    name: input.name,
    mandatory: input.mandatory,
    actions: input.actions.map((action) => ({
      triggers: action.triggers.map((trigger) => ({ transportType: trigger.transportType, name: trigger.name })),
      filters: action.filters.map((filter) => ({
        attribute: filter.attribute,
        enabled: filter.enabled,
        actionFilterOperator: filter.actionFilterOperator,
        valueSource: filter.valueSource,
        values: [...filter.values],
      })),
    })),
  };
  await transport.execute({
    track: "admin",
    document: UPDATE_POLICY_DOCUMENT,
    variables: { policyRequest },
    idempotent: false,
    parse: () => undefined,
  });
}

export interface DeletePolicyInput {
  readonly policyId: string;
}

const DELETE_POLICY_DOCUMENT = `mutation DeletePolicy($policyId: ID!) {
  deletePolicy(policyId: $policyId) {
    policyId
  }
}`;

export async function deletePolicy(transport: AdminTransport, input: DeletePolicyInput): Promise<void> {
  await transport.execute({
    track: "admin",
    document: DELETE_POLICY_DOCUMENT,
    variables: { policyId: input.policyId },
    idempotent: false,
    parse: () => undefined,
  });
}
