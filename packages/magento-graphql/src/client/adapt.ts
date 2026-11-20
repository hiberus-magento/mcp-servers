// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Runs a FIXED document of this package against whatever store is connected (design D14).
//
// The store's schema is read once per client, through the same transport as every other request (so the
// timeout, the rate limit and the retries of a query apply), and shared by concurrent calls. With it, the
// document is trimmed to what the store has (`document.ts`) and an operation the store lacks is refused before
// anything is sent. When it cannot be read:
//
//   - Magento answered and refused (introspection disabled, an error, an answer that is not a schema): it is not
//     asked again for the life of the client — asking again would get the same answer;
//   - the request failed in transit, on a 5xx, a 429, a 401, a 403 or a 404, or the answer was not JSON (a proxy or
//     WAF page): calls go on without it, and the schema is read again once SCHEMA_RETRY_MS have passed — a store
//     that was briefly unreachable, or a token fixed meanwhile, must not switch adaptation off for good, and a
//     store that keeps failing must not pay for a heavy introspection on every call.
//
// Without a schema the full document is sent; when Magento answers `Cannot query field "x" on type "Y"`, a QUERY
// is retried without every selection of `x` — once per field, at most five times. A mutation is never retried.
//
// A variable the caller gave that is dropped with what the store lacks is reported in the result's `warnings`.
import { DocumentReadError, removeFieldsNamed, trimDocument, type TrimOutcome } from "./document.js";
import { MagentoGraphqlError, unsupportedOperation } from "./errors.js";
import type { GraphqlResult } from "./http.js";
import { offersOperation, readStoreSchema, type StoreSchema } from "./schema.js";

export const MAX_FALLBACK_RETRIES = 5;

/** How long after a failed schema read calls go on without the schema before it is read again. */
export const SCHEMA_RETRY_MS = 60_000;

export type OffersOperation = (kind: "query" | "mutation", operation: string) => boolean;

export interface Sender {
  (document: string, variables: Readonly<Record<string, unknown>> | undefined): Promise<GraphqlResult>;
}

/** Failures after which the schema is read again on the next call; any other answer means this store will not give it. */
const TRANSIENT_KINDS: ReadonlySet<string> = new Set(["transport", "rate-limited", "server", "unauthorized", "forbidden", "not-found", "unparseable"]);

const isTransient = (error: unknown): boolean => !(error instanceof MagentoGraphqlError) || TRANSIENT_KINDS.has(error.kind);

function cancelled(): MagentoGraphqlError {
  return new MagentoGraphqlError({ kind: "transport", message: "Magento GraphQL request was cancelled by the client.", retryable: false });
}

/** The shared schema read. `read` is the introspection request; `onSchema` hears once, when a schema is read. */
export function createSchemaSource(read: () => Promise<GraphqlResult>, onSchema?: (offers: OffersOperation) => void, now: () => number = Date.now): (signal?: AbortSignal) => Promise<StoreSchema | undefined> {
  let state: { readonly status: "unknown" } | { readonly status: "failed"; readonly retryAt: number } | { readonly status: "loading"; readonly promise: Promise<StoreSchema | undefined> } | { readonly status: "known"; readonly schema: StoreSchema | undefined } = { status: "unknown" };

  function load(): Promise<StoreSchema | undefined> {
    // No caller's signal: the read is shared, and one caller cancelling must not fail the others.
    const promise = read().then(
      (result) => {
        const schema = readStoreSchema(result.data);
        state = { status: "known", schema };
        if (schema !== undefined) {
          try {
            onSchema?.((kind, operation) => offersOperation(schema, kind, operation));
          } catch {
            // A failing listener only loses the tool-list update; the calls still adapt to the schema.
          }
        }
        return schema;
      },
      (error: unknown) => {
        state = isTransient(error) ? { status: "failed", retryAt: now() + SCHEMA_RETRY_MS } : { status: "known", schema: undefined };
        return undefined;
      },
    );
    state = { status: "loading", promise };
    return promise;
  }

  return async (signal) => {
    if (signal?.aborted === true) throw cancelled();
    if (state.status === "known") return state.schema;
    if (state.status === "failed" && now() < state.retryAt) return undefined;
    const promise = state.status === "loading" ? state.promise : load();
    if (signal === undefined) return promise;
    return new Promise<StoreSchema | undefined>((resolve, reject) => {
      const onAbort = (): void => reject(cancelled());
      signal.addEventListener("abort", onAbort, { once: true });
      void promise.then((schema) => {
        signal.removeEventListener("abort", onAbort);
        resolve(schema);
      });
    });
  };
}

function withoutKeys(variables: Readonly<Record<string, unknown>> | undefined, keys: readonly string[]): Readonly<Record<string, unknown>> | undefined {
  if (variables === undefined || keys.length === 0) return variables;
  return Object.fromEntries(Object.entries(variables).filter(([key]) => !keys.includes(key)));
}

/** Adds a warning for each dropped variable the caller gave a value for. */
function withWarnings(result: GraphqlResult, variables: Readonly<Record<string, unknown>> | undefined, dropped: readonly string[]): GraphqlResult {
  const given = dropped.filter((name) => variables?.[name] !== undefined);
  if (given.length === 0) return result;
  const warnings = given.map((name) => `The connected store does not support the value given for $${name}; it was not sent.`);
  return { ...result, warnings: [...(result.warnings ?? []), ...warnings] };
}

/** Trims per document once per schema: the documents are fixed, so the outcome is too. */
export function createTrimCache(): (document: string, schema: StoreSchema) => TrimOutcome {
  const cache = new WeakMap<StoreSchema, Map<string, TrimOutcome>>();
  return (document, schema) => {
    let outcomes = cache.get(schema);
    if (outcomes === undefined) {
      outcomes = new Map();
      cache.set(schema, outcomes);
    }
    let outcome = outcomes.get(document);
    if (outcome === undefined) {
      outcome = trimDocument(document, schema);
      outcomes.set(document, outcome);
    }
    return outcome;
  };
}

/** Sends a fixed document trimmed to the store's schema; refuses it when the store lacks its operation. */
export async function sendAdapted(kind: "query" | "mutation", document: string, variables: Readonly<Record<string, unknown>> | undefined, outcome: TrimOutcome, send: Sender): Promise<GraphqlResult> {
  switch (outcome.status) {
    case "missing-operation":
      throw unsupportedOperation(kind, outcome.operation, "missing");
    case "nothing-left":
      throw unsupportedOperation(kind, outcome.operation, "nothing-left");
    case "trimmed":
      return withWarnings(await send(outcome.document, withoutKeys(variables, outcome.droppedVariables)), variables, outcome.droppedVariables);
    case "unchanged":
      return send(document, variables);
  }
}

const MISSING_FIELD = /Cannot query field "(\w+)" on type "(\w+)"/g;
const ROOT_TYPES: Readonly<Record<"query" | "mutation", string>> = { query: "Query", mutation: "Mutation" };

/** Without a schema: the full document, then a QUERY retried without each field Magento names as missing. */
export async function sendWithFallback(kind: "query" | "mutation", document: string, variables: Readonly<Record<string, unknown>> | undefined, send: Sender): Promise<GraphqlResult> {
  const removed = new Set<string>();
  const dropped: string[] = [];
  let current = document;
  let currentVariables = variables;
  for (let retries = 0; ; retries += 1) {
    try {
      return withWarnings(await send(current, currentVariables), variables, dropped);
    } catch (error) {
      if (!(error instanceof MagentoGraphqlError) || error.kind !== "invalid-request") throw error;
      const missing = [...error.message.matchAll(MISSING_FIELD)].map((m) => ({ field: m[1] as string, type: m[2] as string }));
      const root = missing.find((m) => m.type === ROOT_TYPES[kind]);
      if (root !== undefined) throw unsupportedOperation(kind, root.field, "missing");
      if (kind === "mutation" || retries >= MAX_FALLBACK_RETRIES) throw error;
      const fresh = [...new Set(missing.map((m) => m.field))].filter((field) => !removed.has(field));
      if (fresh.length === 0) throw error;
      let next: ReturnType<typeof removeFieldsNamed>;
      try {
        next = removeFieldsNamed(current, new Set(fresh));
      } catch (readError) {
        if (readError instanceof DocumentReadError) throw error;
        throw readError;
      }
      if (next === undefined) throw error;
      for (const field of fresh) removed.add(field);
      current = next.document;
      currentVariables = withoutKeys(currentVariables, next.droppedVariables);
      dropped.push(...next.droppedVariables);
    }
  }
}

