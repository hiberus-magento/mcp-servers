// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A route-table fetch double + call recorder (design.md, Decision 5). Lives
// outside `client/` on purpose: it is test-only infrastructure, and the
// client-purity source scan (`purity.test.ts`) and the client-boundary
// eslint rule both operate on `client/**` — this file must never be counted
// against either, and it must never deep-import from `client/` itself (the
// boundary rule forbids exactly that from outside `client/`).
//
// Unlike EDS's fetch double (`"<METHOD> <pathname><search>"`), every ACO
// request is a `POST` to one of two fixed paths — pathname alone cannot
// discriminate between operations. Routes are keyed on
// `"<METHOD> <pathname> <operationName>"`, extracting the operation name
// from the posted GraphQL document. This has a real design consequence
// (design.md, Decision 5): every document under `client/operations/` MUST
// be a NAMED operation, or it is not keyable here at all.
export interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
  readonly operationName: string | undefined;
}

export interface RouteResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** JSON-serializable value, or a raw string body. `undefined` means no body. */
  readonly body?: unknown;
}

export type RouteHandler = (call: RecordedCall) => RouteResponse | Promise<RouteResponse>;

/** Keyed by `"<METHOD> <pathname> <operationName>"`, e.g. `"POST /graphql ListPolicies"`. */
export type RouteTable = Readonly<Record<string, RouteResponse | readonly RouteResponse[] | RouteHandler>>;

export interface FetchDouble {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: readonly RecordedCall[];
}

const NAMED_OPERATION_PATTERN = /^\s*(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/;

function extractOperationName(body: string | undefined): string | undefined {
  if (body === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || !("query" in parsed) || typeof parsed.query !== "string") {
    return undefined;
  }
  return NAMED_OPERATION_PATTERN.exec(parsed.query)?.[1];
}

function routeKey(method: string, url: string, operationName: string | undefined): string {
  const parsed = new URL(url);
  return `${method} ${parsed.pathname} ${operationName ?? "<unnamed>"}`;
}

function headersToRecord(init: RequestInit["headers"] | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  if (init === undefined) {
    return record;
  }
  new Headers(init).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function buildResponse(route: RouteResponse): Response {
  const headers = new Headers(route.headers);
  let bodyText: string | undefined;
  if (route.body !== undefined) {
    if (typeof route.body === "string") {
      bodyText = route.body;
    } else {
      bodyText = JSON.stringify(route.body);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }
  }
  return new Response(bodyText ?? null, { status: route.status, headers });
}

/**
 * Creates an in-memory `fetch` double driven by an exact-match route table
 * keyed on the posted operation name. Every call is recorded for
 * order/shape assertions.
 */
export function createFetchDouble(routes: RouteTable): FetchDouble {
  const calls: RecordedCall[] = [];
  const cursors = new Map<string, number>();

  const fetchDouble = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = headersToRecord(init?.headers);
    const body = typeof init?.body === "string" ? init.body : undefined;
    const operationName = extractOperationName(body);
    const call: RecordedCall = { method, url, headers, body, operationName };
    calls.push(call);

    const key = routeKey(method, url, operationName);
    const route = routes[key];
    if (route === undefined) {
      throw new Error(`FetchDouble: no route registered for "${key}"`);
    }

    let response: RouteResponse;
    if (typeof route === "function") {
      response = await route(call);
    } else if (Array.isArray(route)) {
      const index = cursors.get(key) ?? 0;
      const boundedIndex = Math.min(index, route.length - 1);
      response = route[boundedIndex] as RouteResponse;
      cursors.set(key, index + 1);
    } else {
      response = route as RouteResponse;
    }

    return buildResponse(response);
  }) as typeof globalThis.fetch;

  return { fetch: fetchDouble, calls };
}

export interface GraphQlErrorEntryLike {
  readonly message?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/** A well-formed success: `data` only, no `errors` key at all. */
export const graphQlOk = (data: unknown): RouteResponse => ({ status: 200, body: { data } });

/** HTTP 200. `response.ok` is true. AND IT IS A FAILURE — errors[] is non-empty. */
export const graphQlErrors = (errors: readonly GraphQlErrorEntryLike[]): RouteResponse => ({ status: 200, body: { data: null, errors } });

/** Both halves present — the partial-success case (design.md, Decision 1). */
export const graphQlPartial = (data: unknown, errors: readonly GraphQlErrorEntryLike[]): RouteResponse => ({ status: 200, body: { data, errors } });

/** A status-only failure with NO GraphQL envelope. MUST NOT classify as a throttle. */
export const transportFailure = (status: number): RouteResponse => ({ status, body: "upstream failure" });
