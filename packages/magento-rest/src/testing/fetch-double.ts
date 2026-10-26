// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A route-table fetch double + call recorder. Lives outside `client/` on
// purpose: it is test-only infrastructure, and the client-purity scan
// (`client/purity.test.ts`) and the client-boundary eslint rule both operate
// on `client/**` — this file must never be counted against either, and must
// never deep-import from `client/` itself.
//
// Magento REST is addressed by path and query, not by a GraphQL operation
// name, so routes are keyed on `"<METHOD> <pathname><search>"` (the shape
// EDS's double uses) with a fallback to `"<METHOD> <pathname>"`. The exact
// key wins, so a test can pin one `searchCriteria` query while a looser
// route serves everything else.
export interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
}

export interface RouteResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** JSON-serializable value, or a raw string body. `undefined` means no body. */
  readonly body?: unknown;
}

export type RouteHandler = (call: RecordedCall) => RouteResponse | Promise<RouteResponse>;

export type RouteTable = Readonly<Record<string, RouteResponse | readonly RouteResponse[] | RouteHandler>>;

export interface FetchDouble {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: readonly RecordedCall[];
}

/** Shorthand for a JSON response. */
export const json = (status: number, body: unknown): RouteResponse => ({ status, body });

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

/** Creates an in-memory `fetch` double driven by an exact-match route table; every call is recorded. */
export function createFetchDouble(routes: RouteTable): FetchDouble {
  const calls: RecordedCall[] = [];
  const cursors = new Map<string, number>();

  const fetchDouble = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const call: RecordedCall = {
      method,
      url,
      headers: headersToRecord(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);

    const parsed = new URL(url);
    const exactKey = `${method} ${parsed.pathname}${parsed.search}`;
    const pathKey = `${method} ${parsed.pathname}`;
    const key = exactKey in routes ? exactKey : pathKey;
    const route = routes[key];
    if (route === undefined) {
      throw new Error(`FetchDouble: no route registered for "${exactKey}"`);
    }

    let response: RouteResponse;
    if (typeof route === "function") {
      response = await route(call);
    } else if (Array.isArray(route)) {
      const index = cursors.get(key) ?? 0;
      response = route[Math.min(index, route.length - 1)] as RouteResponse;
      cursors.set(key, index + 1);
    } else {
      response = route as RouteResponse;
    }
    return buildResponse(response);
  }) as typeof globalThis.fetch;

  return { fetch: fetchDouble, calls };
}
