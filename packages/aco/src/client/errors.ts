// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The ACO client error hierarchy (design.md, Decision 1). ACO returns HTTP
// 200 with a GraphQL `errors[]` array for failures, so classification is
// keyed off `errors[].extensions`, never `response.status` — none of these
// classes carries a `status`-driven construction path. `AcoTransportError`
// is the sole exception: it is a transport-level failure (rejected fetch,
// unparseable body, or a response with no GraphQL envelope at all), and its
// `status` field is purely diagnostic metadata, never a classification input.
//
// `RetryableAcoError` (design.md, Decision 1) excludes everything that must
// not be replayed — `AdminScopeError | CatalogViewAccessError |
// AcoOperationError | AcoSchemaMismatchError` are NOT members, proven by
// `errors.test-d.ts`.
export type AcoErrorKind = "catalog-view-access" | "admin-scope" | "throttled" | "operation" | "transport" | "schema-mismatch";

export abstract class AcoError extends Error {
  abstract readonly kind: AcoErrorKind;
  abstract readonly remedy: string;
  /** Literal discriminant. Every consumer switches on it under `assertNever`. */
  abstract readonly signalledBy: "graphql-errors" | "transport" | "client";
  /** How much to trust the classification. Surfaced to the agent, not just a comment. */
  abstract readonly confidence: "documented-extension" | "heuristic" | "certain";
}

export interface GraphQlErrorLikeOptions {
  /** The message of the entry that CHOSE this class — the one `classify()` matched on. */
  readonly message?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly operationName: string;
  /**
   * Every message the response's `errors[]` carried, in wire order.
   *
   * CHANGED DELIBERATELY: these errors used to render `errors[0]` and
   * nothing else. A multi-error validation failure therefore arrived as
   * `ACO GraphQL operation "SearchCatalog" failed: Validation error(s)` —
   * the one entry that names nothing — while the entries naming the
   * offending argument were dropped on the floor. The server had said which
   * argument all along; finding that out cost a bisection.
   */
  readonly messages?: readonly string[];
}

// Bounds on the RENDERED string only. An error message ends up in logs, and
// a server that rejects every argument of a large query can return dozens of
// entries. `AcoError.messages` keeps all of them regardless — truncating the
// data as well would recreate the defect these bounds sit next to.
const MAX_RENDERED_MESSAGES = 5;
const MAX_RENDERED_MESSAGE_LENGTH = 300;

function truncate(message: string): string {
  return message.length <= MAX_RENDERED_MESSAGE_LENGTH ? message : `${message.slice(0, MAX_RENDERED_MESSAGE_LENGTH)}…`;
}

/**
 * The classified entry's own message first — it is the one that selected
 * this class and its remedy — then every OTHER message from the same
 * response, in wire order. An entry with no message contributes nothing
 * rather than an empty slot.
 */
function orderedMessages(options: GraphQlErrorLikeOptions): readonly string[] {
  const rest = [...(options.messages ?? [])];
  if (options.message === undefined) {
    return rest;
  }
  const classified = rest.indexOf(options.message);
  if (classified >= 0) {
    rest.splice(classified, 1);
  }
  return [options.message, ...rest];
}

function describeFailure(options: GraphQlErrorLikeOptions): string {
  const ordered = orderedMessages(options);
  if (ordered.length === 0) {
    return ".";
  }
  if (ordered.length === 1) {
    return `: ${truncate(ordered[0] ?? "")}`;
  }
  const shown = ordered.slice(0, MAX_RENDERED_MESSAGES).map((entry, index) => `[${index + 1}] ${truncate(entry)}`);
  const omitted = ordered.length - shown.length;
  return `: ${ordered.length} errors — ${shown.join(" ")}${omitted > 0 ? ` (+${omitted} more)` : ""}`;
}

/**
 * `x-commerce-exception === "access-key-invalid"` (exact value, not
 * substring — design.md, Decision 1). The restricted access key for a
 * protected catalog view is missing, invalid, or expired.
 */
export class CatalogViewAccessError extends AcoError {
  readonly kind = "catalog-view-access" as const;
  readonly signalledBy = "graphql-errors" as const;
  readonly confidence = "documented-extension" as const;
  readonly remedy =
    "Register or rotate a restricted access key for this catalog view in Adobe Commerce Studio, " +
    "then supply it through the client's catalogViewAccessToken supplier.";
  readonly operationName: string;
  readonly extensions: Readonly<Record<string, unknown>> | undefined;
  /** Every message the response carried, classified entry first. */
  readonly messages: readonly string[];

  constructor(options: GraphQlErrorLikeOptions) {
    super(`ACO catalog-view access denied for operation "${options.operationName}"${describeFailure(options)}`);
    this.name = "CatalogViewAccessError";
    this.operationName = options.operationName;
    this.extensions = options.extensions;
    this.messages = orderedMessages(options);
  }
}

/**
 * `classification`/`code`/`message` matches `/permission|scope|unauthor|forbidden/i`
 * (design.md, Decision 1). Adobe publishes no structured code for this case —
 * `confidence: "heuristic"` is a runtime field an agent can read, not a comment.
 * The remedy names BOTH exits: re-attempting the mint, or pasting a Studio
 * session Bearer.
 */
export class AdminScopeError extends AcoError {
  readonly kind = "admin-scope" as const;
  readonly signalledBy = "graphql-errors" as const;
  readonly confidence = "heuristic" as const;
  readonly remedy =
    "The admin credential appears to lack the required scope (heuristic classification — Adobe documents no structured code for " +
    "this case). Two exits: re-attempt `hiberus-aco auth mint`, or paste a fresh Studio session Bearer with `hiberus-aco auth token set`.";
  readonly operationName: string;
  readonly extensions: Readonly<Record<string, unknown>> | undefined;
  /** Every message the response carried, classified entry first. */
  readonly messages: readonly string[];

  constructor(options: GraphQlErrorLikeOptions) {
    super(`ACO admin scope error for operation "${options.operationName}"${describeFailure(options)}`);
    this.name = "AdminScopeError";
    this.operationName = options.operationName;
    this.extensions = options.extensions;
    this.messages = orderedMessages(options);
  }
}

/**
 * `classification`/`code` matches `/throttl|rate.?limit|too.?many/i`
 * (design.md, Decision 1). There is no documented throttle signal for either
 * ACO surface — `confidence: "heuristic"` is a runtime field, not a comment.
 * There is no `Retry-After` on this surface, so `retryAfterMs` is never
 * populated here; backoff is always full-jitter exponential (`retry.ts`).
 */
export class AcoThrottledError extends AcoError {
  readonly kind = "throttled" as const;
  readonly signalledBy = "graphql-errors" as const;
  readonly confidence = "heuristic" as const;
  readonly remedy =
    "The ACO admin surface appears to be rate-limiting this client (heuristic classification — Adobe publishes no throttle " +
    "signal for this endpoint). Back off and retry; the client's pacer and retry policy do this automatically.";
  readonly operationName: string;
  readonly extensions: Readonly<Record<string, unknown>> | undefined;
  /** Every message the response carried, classified entry first. */
  readonly messages: readonly string[];

  constructor(options: GraphQlErrorLikeOptions) {
    super(`ACO throttled on operation "${options.operationName}"${describeFailure(options)}`);
    this.name = "AcoThrottledError";
    this.operationName = options.operationName;
    this.extensions = options.extensions;
    this.messages = orderedMessages(options);
  }
}

export interface AcoOperationErrorOptions extends GraphQlErrorLikeOptions {
  /**
   * `true` when the response carried both `data` and a non-empty `errors[]`
   * (design.md, Decision 1's partial-success case). The `data` payload
   * itself is never attached to this error — a large body in an error
   * message ends up in logs.
   */
  readonly hadPartialData: boolean;
}

/**
 * The fallthrough classification: any `errors[]` entry that did not match
 * `CatalogViewAccessError`, `AcoThrottledError`, or `AdminScopeError`.
 * `confidence: "certain"` because it IS a failure — only the reason is
 * Adobe's own, surfaced verbatim in `message` and `extensions`.
 */
export class AcoOperationError extends AcoError {
  readonly kind = "operation" as const;
  readonly signalledBy = "graphql-errors" as const;
  readonly confidence = "certain" as const;
  readonly remedy: string;
  readonly operationName: string;
  readonly extensions: Readonly<Record<string, unknown>> | undefined;
  readonly hadPartialData: boolean;
  /** Every message the response carried, classified entry first. */
  readonly messages: readonly string[];

  constructor(options: AcoOperationErrorOptions) {
    super(`ACO GraphQL operation "${options.operationName}" failed${describeFailure(options)}`);
    this.name = "AcoOperationError";
    this.operationName = options.operationName;
    this.extensions = options.extensions;
    this.hadPartialData = options.hadPartialData;
    this.messages = orderedMessages(options);
    this.remedy = options.hadPartialData
      ? "Adobe reported a failure alongside a partial response for this operation. The partial payload was discarded rather " +
        "than returned half-empty; investigate with `hiberus-aco api query` if you need to see what came back."
      : "Adobe reported a GraphQL-level failure for this operation. See this error's message and extensions for Adobe's own diagnosis.";
  }
}

export type AcoTransportErrorReason = "fetch-rejected" | "unparseable-body" | "no-graphql-envelope";

export interface AcoTransportErrorOptions {
  readonly reason: AcoTransportErrorReason;
  readonly status?: number;
  readonly cause?: unknown;
}

/**
 * A transport-level failure: the fetch itself rejected, the body was not
 * parseable JSON, or the parsed body had neither `data` nor `errors` — i.e.
 * no GraphQL envelope was ever produced. `readEnvelope()` in `http.ts` is
 * the sole construction site. `status`, when present, is diagnostic
 * metadata only — it never drives classification (design.md, Decision 1: a
 * raw 429 with no `errors[]` is `AcoTransportError`, never a throttle).
 */
export class AcoTransportError extends AcoError {
  readonly kind = "transport" as const;
  readonly signalledBy = "transport" as const;
  readonly confidence = "certain" as const;
  readonly remedy =
    "A transport-level failure occurred before any GraphQL response could be classified. Network and gateway failures are " +
    "generally safe to retry; a persistent failure may indicate the endpoint URL or network path is misconfigured.";
  readonly reason: AcoTransportErrorReason;
  readonly status: number | undefined;

  constructor(options: AcoTransportErrorOptions) {
    super(`ACO transport failure (${options.reason})${options.status !== undefined ? ` — HTTP ${options.status}` : ""}.`);
    this.name = "AcoTransportError";
    this.reason = options.reason;
    this.status = options.status;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export interface AcoSchemaMismatchErrorOptions {
  readonly operationName: string;
  /** e.g. `catalogViews[].viewId` — the keyed field the response was missing. */
  readonly fieldPath: string;
}

/**
 * Thrown by `client/types.ts` (Phase 2) when a response is missing a
 * KEYED field the six tools rely on — never for a missing OPTIONAL field,
 * which resolves to `undefined` instead (design.md, Decision 4's tolerant
 * parsing rule). `signalledBy: "client"` because this is our own
 * expectation failing, not something Adobe reported.
 */
export class AcoSchemaMismatchError extends AcoError {
  readonly kind = "schema-mismatch" as const;
  readonly signalledBy = "client" as const;
  readonly confidence = "certain" as const;
  readonly remedy: string;
  readonly operationName: string;
  readonly fieldPath: string;

  constructor(options: AcoSchemaMismatchErrorOptions) {
    const remedy =
      `\`${options.operationName}\` expected \`${options.fieldPath}\` and it was absent. The ACO admin GraphQL surface is ` +
      "undocumented; this query was derived from a reverse-engineered client and may be stale. Compare against a live " +
      "response with `hiberus-aco api query`, then correct the document in `client/operations/`.";
    super(remedy);
    this.name = "AcoSchemaMismatchError";
    this.operationName = options.operationName;
    this.fieldPath = options.fieldPath;
    this.remedy = remedy;
  }
}

/**
 * The retryable union (design.md, Decision 1): retrying anything else here
 * is a `tsc` error, exactly as in `eds/client/retry.ts`. Proven by
 * `errors.test-d.ts`.
 */
export type RetryableAcoError = AcoThrottledError | AcoTransportError;
