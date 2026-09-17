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

export interface UpdatePolicyInput {
  readonly policyId: string;
  readonly enabled: boolean;
}

const UPDATE_POLICY_DOCUMENT = `mutation UpdatePolicy($policyId: ID!, $enabled: Boolean!) {
  updatePolicy(policyId: $policyId, enabled: $enabled) {
    policyId
  }
}`;

export async function updatePolicy(transport: AdminTransport, input: UpdatePolicyInput): Promise<void> {
  await transport.execute({
    track: "admin",
    document: UPDATE_POLICY_DOCUMENT,
    variables: { policyId: input.policyId, enabled: input.enabled },
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
