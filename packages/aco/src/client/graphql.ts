// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The GraphQL envelope classifier (design.md, Decision 1). ACO returns HTTP
// 200 with a `data`/`errors` GraphQL envelope for both success AND failure
// — a status-based transport is not a weaker design here, it is a wrong
// one. The organising principle: the status code and the GraphQL envelope
// are read by two different functions, and neither can see the other's
// input. `classify()` below is that function for the envelope, and it has
// NO `status` parameter — a 200-with-`errors[]` cannot be misread as
// success here, and a 429 cannot be misread as a throttle here, because
// there is nothing in this module's input that carries a status at all.
import { AcoOperationError, AcoThrottledError, AdminScopeError, CatalogViewAccessError, type GraphQlErrorLikeOptions } from "./errors.js";

// The brand symbol is NOT exported — `mcp-core/src/exec/command-spec.ts`
// brands `Argv` the same way. Outside this module, nothing can construct a
// `ClassifiedData<T>` except by going through `classify()`.
declare const Classified: unique symbol;

/** A GraphQL `data` payload that has been through `classify()`. Unforgeable elsewhere. */
export type ClassifiedData<T> = T & { readonly [Classified]: true };

/** Operation parsers cannot be called on a raw body — the argument type is branded. */
export type OperationParser<T> = (data: ClassifiedData<unknown>) => T;

export interface GraphQlErrorEntry {
  readonly message?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

interface GraphQlEnvelope {
  readonly data?: unknown;
  readonly errors?: readonly GraphQlErrorEntry[];
}

/** Enough context for `classify()` to name the failing operation in a thrown error. */
export interface OperationRef {
  readonly name: string;
}

// Heuristic — Adobe publishes no structured code for either the scope or
// the throttle case on this surface (design.md, Decision 1). Order below
// matters: exact-value match is checked first and independently, so a
// throttle whose message happens to contain "forbidden" is never misrouted
// into a credential remedy the operator would then act on pointlessly.
const THROTTLE_PATTERN = /throttl|rate.?limit|too.?many/i;
const SCOPE_PATTERN = /permission|scope|unauthor|forbidden/i;

function matchesExtensionField(extensions: Readonly<Record<string, unknown>> | undefined, pattern: RegExp): boolean {
  if (extensions === undefined) {
    return false;
  }
  const classification = extensions["classification"];
  const code = extensions["code"];
  return (typeof classification === "string" && pattern.test(classification)) || (typeof code === "string" && pattern.test(code));
}

function isThrottleShaped(entry: GraphQlErrorEntry): boolean {
  return matchesExtensionField(entry.extensions, THROTTLE_PATTERN);
}

function isScopeShaped(entry: GraphQlErrorEntry): boolean {
  return matchesExtensionField(entry.extensions, SCOPE_PATTERN) || (typeof entry.message === "string" && SCOPE_PATTERN.test(entry.message));
}

function isExactAccessKeyInvalid(entry: GraphQlErrorEntry): boolean {
  // Exact value, not substring (design.md, Decision 1) — deliberately NOT
  // using a regex here, so "access-key-invalid-but-different" cannot match.
  return entry.extensions?.["x-commerce-exception"] === "access-key-invalid";
}

function toErrorOptions(entry: GraphQlErrorEntry, op: OperationRef): GraphQlErrorLikeOptions {
  const options: GraphQlErrorLikeOptions = { operationName: op.name };
  return {
    ...options,
    ...(entry.message !== undefined ? { message: entry.message } : {}),
    ...(entry.extensions !== undefined ? { extensions: entry.extensions } : {}),
  };
}

/**
 * The ONLY producer of `ClassifiedData<T>` and the ONLY construction site
 * for every GraphQL-level `AcoError`. Reads `envelope.errors` BEFORE it
 * reads `envelope.data`, and — deliberately — takes exactly 2 parameters,
 * neither of which is a status code. Any non-empty `errors[]` is a failure
 * and `data` is discarded (design.md, Decision 1's partial-success rule):
 * a partial response here is a failed operation with a nulled field, not a
 * usefully degraded result.
 */
export function classify<T>(envelope: GraphQlEnvelope, op: OperationRef): ClassifiedData<T> {
  const errors = envelope.errors;
  if (errors !== undefined && errors.length > 0) {
    const hadPartialData = envelope.data !== undefined && envelope.data !== null;

    for (const entry of errors) {
      if (isExactAccessKeyInvalid(entry)) {
        throw new CatalogViewAccessError(toErrorOptions(entry, op));
      }
    }
    for (const entry of errors) {
      if (isThrottleShaped(entry)) {
        throw new AcoThrottledError(toErrorOptions(entry, op));
      }
    }
    for (const entry of errors) {
      if (isScopeShaped(entry)) {
        throw new AdminScopeError(toErrorOptions(entry, op));
      }
    }

    const first = errors[0];
    const fallthroughOptions: GraphQlErrorLikeOptions = first !== undefined ? toErrorOptions(first, op) : { operationName: op.name };
    throw new AcoOperationError({ ...fallthroughOptions, hadPartialData });
  }

  return envelope.data as ClassifiedData<T>;
}
