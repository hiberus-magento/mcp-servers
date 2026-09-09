// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A route-table fetch double + call recorder (design.md, Decision 2). Lives
// outside `client/` on purpose: it is test-only infrastructure, and the
// client-purity source scan (`purity.test.ts`) and the client-boundary
// eslint rule both operate on `client/**` — this file must never be counted
// against either.
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

/** Keyed by `"<METHOD> <pathname><search>"`, e.g. `"GET /config/acme-demo-org.json"`. */
export type RouteTable = Readonly<Record<string, RouteResponse | readonly RouteResponse[] | RouteHandler>>;

export interface FetchDouble {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: readonly RecordedCall[];
}

function routeKey(method: string, url: string): string {
  const parsed = new URL(url);
  return `${method} ${parsed.pathname}${parsed.search}`;
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
 * Creates an in-memory `fetch` double driven by an exact-match route table.
 * Every call is recorded (method, URL, headers, raw body) for order/shape
 * assertions. A route value that is an array is consumed sequentially (one
 * response per call, holding the last entry once exhausted) — used to
 * simulate a job transitioning from `running` to `completed` across polls.
 */
export function createFetchDouble(routes: RouteTable): FetchDouble {
  const calls: RecordedCall[] = [];
  const cursors = new Map<string, number>();

  const fetchDouble = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = headersToRecord(init?.headers);
    const body = typeof init?.body === "string" ? init.body : undefined;
    const call: RecordedCall = { method, url, headers, body };
    calls.push(call);

    const key = routeKey(method, url);
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
