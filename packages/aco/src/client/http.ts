// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The two transports (design.md, Decisions 1 & 2). `readEnvelope()` is the
// ONLY function in `packages/aco` that reads `response.status`, and its
// only possible failure output is `AcoTransportError`:
//
//   fetch rejects ─────────────────────────► AcoTransportError (cause)
//   body is not JSON ──────────────────────► AcoTransportError (unparseable)
//   JSON has neither `data` nor `errors` ──► AcoTransportError (no envelope)
//   otherwise ─────────────────────────────► classify(envelope, op)   status discarded here
//
// `AdminTransportDeps` and `MerchandisingTransportDeps` are structurally
// distinct types: `MerchandisingTransportDeps` has NO `tokenProvider` field
// at all, so a Merchandising operation cannot accidentally acquire an admin
// credential — there is nothing to read it from. This is enforced by types
// (`http.test-d.ts`), not by care. Operations are phantom-typed by track
// (`GraphQlOperation<TTrack, TResult>`), so `AdminTransport.execute` cannot
// accept a Merchandising operation and vice versa — routing an admin query
// over the merchandising URL is a `tsc` error.
import type { TokenProvider } from "@hiberus-magento/mcp-core";
import { AcoTransportError } from "./errors.js";
import { classify, type ClassifiedData, type GraphQlErrorEntry, type OperationParser, type OperationRef } from "./graphql.js";
import { buildAdminHeaders, buildMerchandisingHeaders, type AcoHeaderRecord, type CatalogViewAccessTokenSupplier } from "./headers.js";
import { ADMIN_PACE, MERCH_PACE, TokenBucketRateLimiter } from "./rate-limiter.js";

export type Track = "admin" | "merchandising";

export interface GraphQlOperation<TTrack extends Track, TResult> {
  readonly track: TTrack;
  /** MUST be a named operation — the fixture double keys on the name (design.md, Decision 5). */
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly parse: OperationParser<TResult>;
  /**
   * Whether replaying this operation on a retryable failure is safe. Absent
   * means `true` (queries default to idempotent) — the six admin mutations
   * (`operations/mutations.ts`) are the only operations that set this to
   * `false` explicitly, so a misclassified throttle can never replay a
   * write (design.md, Decision 4). `client/index.ts`'s factory reads this
   * field to drive `retry.ts`'s `decideRetry`.
   */
  readonly idempotent?: boolean;
}

export interface AdminTransportDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly baseUrl: string;
  readonly tokenProvider: TokenProvider;
  readonly apiKey?: string;
  readonly imsOrgId?: string;
}

export interface MerchandisingTransportDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly baseUrl: string;
  /** Absent by default. Protected catalog views only (design.md, Decision 2). */
  readonly catalogViewAccessToken?: CatalogViewAccessTokenSupplier;
}

export interface AdminTransport {
  execute<T>(operation: GraphQlOperation<"admin", T>): Promise<T>;
}

/** Per-request routing context every Merchandising call needs — `AC-View-ID` is a required header on that endpoint, never a credential. */
export interface MerchandisingRequestContext {
  readonly viewId: string;
  readonly locale: string;
  readonly priceBookId?: string;
  readonly policies?: Readonly<Record<string, string>>;
}

export interface MerchandisingTransport {
  execute<T>(operation: GraphQlOperation<"merchandising", T>, context: MerchandisingRequestContext): Promise<T>;
}

const NAMED_OPERATION_PATTERN = /^\s*(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/;

function extractOperationName(document: string): string {
  return NAMED_OPERATION_PATTERN.exec(document)?.[1] ?? "anonymous";
}

/**
 * The ONLY function that reads `response.status`. Its output is always
 * `AcoTransportError` — never a classified success and never any other
 * `AcoError` subclass. Once a well-formed GraphQL envelope is found,
 * `classify()` takes over and status is discarded (design.md, Decision 1).
 */
async function readEnvelope<T>(response: Response, op: OperationRef): Promise<ClassifiedData<T>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new AcoTransportError({ reason: "unparseable-body", status: response.status, cause });
  }
  if (body === null || typeof body !== "object" || (!("data" in body) && !("errors" in body))) {
    throw new AcoTransportError({ reason: "no-graphql-envelope", status: response.status });
  }
  return classify<T>(body as { readonly data?: unknown; readonly errors?: readonly GraphQlErrorEntry[] }, op);
}

async function sendGraphQlRequest<TTrack extends Track, T>(options: {
  readonly fetch: typeof globalThis.fetch;
  readonly url: string;
  readonly headers: AcoHeaderRecord;
  readonly operation: GraphQlOperation<TTrack, T>;
}): Promise<T> {
  const op: OperationRef = { name: extractOperationName(options.operation.document) };
  let response: Response;
  try {
    response = await options.fetch(options.url, {
      method: "POST",
      headers: options.headers as Record<string, string>,
      body: JSON.stringify({ query: options.operation.document, variables: options.operation.variables ?? {} }),
    });
  } catch (cause) {
    throw new AcoTransportError({ reason: "fetch-rejected", cause });
  }
  const classified = await readEnvelope<T>(response, op);
  return options.operation.parse(classified);
}

export function createAdminTransport(deps: AdminTransportDeps): AdminTransport {
  const rateLimiter = new TokenBucketRateLimiter(ADMIN_PACE, { now: deps.now, sleep: deps.sleep });
  return {
    async execute<T>(operation: GraphQlOperation<"admin", T>): Promise<T> {
      await rateLimiter.acquire();
      const credential = await deps.tokenProvider.getToken();
      const headers = buildAdminHeaders({
        token: credential.value,
        ...(deps.apiKey !== undefined ? { apiKey: deps.apiKey } : {}),
        ...(deps.imsOrgId !== undefined ? { imsOrgId: deps.imsOrgId } : {}),
      });
      return sendGraphQlRequest({ fetch: deps.fetch, url: deps.baseUrl, headers, operation });
    },
  };
}

export function createMerchandisingTransport(deps: MerchandisingTransportDeps): MerchandisingTransport {
  const rateLimiter = new TokenBucketRateLimiter(MERCH_PACE, { now: deps.now, sleep: deps.sleep });
  return {
    async execute<T>(operation: GraphQlOperation<"merchandising", T>, context: MerchandisingRequestContext): Promise<T> {
      await rateLimiter.acquire();
      const catalogViewAccessToken = deps.catalogViewAccessToken !== undefined ? await deps.catalogViewAccessToken() : undefined;
      const headers = buildMerchandisingHeaders({
        viewId: context.viewId,
        locale: context.locale,
        ...(context.priceBookId !== undefined ? { priceBookId: context.priceBookId } : {}),
        ...(catalogViewAccessToken !== undefined ? { catalogViewAccessToken } : {}),
        ...(context.policies !== undefined ? { policies: context.policies } : {}),
      });
      return sendGraphQlRequest({ fetch: deps.fetch, url: deps.baseUrl, headers, operation });
    },
  };
}
