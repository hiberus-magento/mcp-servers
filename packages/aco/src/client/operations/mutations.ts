// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The six admin mutations (exploration.md): `createChannel`/`updateChannel`/
// `deleteChannel` and `createPolicy`/`updatePolicy`/`deletePolicy`. This is
// the ONLY module under `client/` allowed to contain the token `mutation `
// — a source-scan test in `mutations.test.ts` enforces it, so a seventh
// mutation anywhere else in the tree is a named, reviewable diff. Every
// mutation declares `idempotent: false` (design.md, Decision 4): a
// misclassified throttle can never replay a write, and `client/index.ts`'s
// factory reads this field to drive `retry.ts`.
//
// `createChannel`'s own response does not accept `defaultPriceBookId` as an
// input in the same mutation (exploration.md, `provision`'s mapped steps) —
// creating a fully-configured view is deliberately TWO calls:
// `createChannel` then `updateChannel`, never one.
import type { AdminTransport } from "../http.js";

export const ADMIN_MUTATION_NAMES = ["createChannel", "updateChannel", "deleteChannel", "createPolicy", "updatePolicy", "deletePolicy"] as const;

export type AdminMutationName = (typeof ADMIN_MUTATION_NAMES)[number];

export interface CreateChannelInput {
  readonly name: string;
  readonly locale: string;
}

export interface CreateChannelResult {
  readonly channelId: string;
}

const CREATE_CHANNEL_DOCUMENT = `mutation CreateChannel($name: String!, $locale: String!) {
  createChannel(name: $name, locale: $locale) {
    channelId
  }
}`;

export async function createChannel(transport: AdminTransport, input: CreateChannelInput): Promise<CreateChannelResult> {
  return transport.execute({
    track: "admin",
    document: CREATE_CHANNEL_DOCUMENT,
    variables: { name: input.name, locale: input.locale },
    idempotent: false,
    parse: (data) => {
      const record = data as { readonly createChannel?: { readonly channelId?: string } };
      return { channelId: record.createChannel?.channelId ?? "" };
    },
  });
}

export interface UpdateChannelInput {
  readonly channelId: string;
  readonly defaultPriceBookId?: string;
  readonly policyIds?: readonly string[];
}

const UPDATE_CHANNEL_DOCUMENT = `mutation UpdateChannel($channelId: ID!, $defaultPriceBookId: ID, $policyIds: [ID!]) {
  updateChannel(channelId: $channelId, defaultPriceBookId: $defaultPriceBookId, policyIds: $policyIds) {
    channelId
  }
}`;

export async function updateChannel(transport: AdminTransport, input: UpdateChannelInput): Promise<void> {
  await transport.execute({
    track: "admin",
    document: UPDATE_CHANNEL_DOCUMENT,
    variables: { channelId: input.channelId, defaultPriceBookId: input.defaultPriceBookId, policyIds: input.policyIds },
    idempotent: false,
    parse: () => undefined,
  });
}

export interface DeleteChannelInput {
  readonly channelId: string;
}

const DELETE_CHANNEL_DOCUMENT = `mutation DeleteChannel($channelId: ID!) {
  deleteChannel(channelId: $channelId) {
    channelId
  }
}`;

export async function deleteChannel(transport: AdminTransport, input: DeleteChannelInput): Promise<void> {
  await transport.execute({
    track: "admin",
    document: DELETE_CHANNEL_DOCUMENT,
    variables: { channelId: input.channelId },
    idempotent: false,
    parse: () => undefined,
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
