// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A fetch double + call recorder for GraphQL. Lives outside `client/` on purpose: it is test-only
// infrastructure and must never be counted by the purity scan or the client-boundary rule.
//
// Every GraphQL call is a `POST` to ONE URL, so routes cannot be keyed by path. A handler receives
// the parsed request (`query`, `variables`, `operationName`) and answers; a response list is served
// in order, the last repeating.
export interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
  /** The JSON body, when there is one. */
  readonly request: { readonly query: string; readonly variables?: Record<string, unknown>; readonly operationName?: string } | undefined;
}

export interface RouteResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** JSON-serializable value, or a raw string body. `undefined` means no body. */
  readonly body?: unknown;
}

export type Responder = RouteResponse | readonly RouteResponse[] | ((call: RecordedCall) => RouteResponse | Promise<RouteResponse>);

export interface FetchDouble {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: readonly RecordedCall[];
}

export const json = (status: number, body: unknown): RouteResponse => ({ status, body });
/** A GraphQL success: HTTP 200 with `{ data }`. */
export const data = (value: unknown): RouteResponse => ({ status: 200, body: { data: value } });
/** A GraphQL failure: HTTP 200 with `{ errors }` and optionally partial `data`. */
export const gqlErrors = (messages: readonly string[], partial?: unknown, category?: string): RouteResponse => ({
  status: 200,
  body: { ...(partial !== undefined ? { data: partial } : {}), errors: messages.map((message) => ({ message, ...(category !== undefined ? { extensions: { category } } : {}) })) },
});

export function createFetchDouble(responder: Responder): FetchDouble {
  const calls: RecordedCall[] = [];
  let cursor = 0;
  const fetchDouble = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const body = typeof init?.body === "string" ? init.body : undefined;
    let request: RecordedCall["request"];
    try {
      request = body === undefined ? undefined : (JSON.parse(body) as RecordedCall["request"]);
    } catch {
      request = undefined;
    }
    const call: RecordedCall = { method: (init?.method ?? "GET").toUpperCase(), url, headers, body, request };
    calls.push(call);
    let response: RouteResponse;
    if (typeof responder === "function") {
      response = await responder(call);
    } else if (Array.isArray(responder)) {
      response = responder[Math.min(cursor, responder.length - 1)] as RouteResponse;
      cursor += 1;
    } else {
      response = responder as RouteResponse;
    }
    const responseHeaders = new Headers(response.headers);
    let text: string | undefined;
    if (response.body !== undefined) {
      text = typeof response.body === "string" ? response.body : JSON.stringify(response.body);
      if (typeof response.body !== "string" && !responseHeaders.has("content-type")) responseHeaders.set("content-type", "application/json");
    }
    return new Response(text ?? null, { status: response.status, headers: responseHeaders });
  }) as typeof globalThis.fetch;
  return { fetch: fetchDouble, calls };
}
