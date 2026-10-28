// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// A small stateful author for plan/apply tests: pages and sheets live in
// maps a test can mutate between `aem_plan` and `aem_apply` (to prove stale
// detection), reads are answered from them, and every POST is recorded and
// answered 200 unless a test says otherwise. It does not apply the writes —
// the tests assert on the exact requests, which is what `aem_apply` owns.
import { createAemClient, type AemClient } from "../client/index.js";
import { SYNTHETIC_AEM_AUTHOR, tokenProvider } from "./author-double.js";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string | undefined;
}

export interface FakeAuthor {
  readonly pages: Map<string, Record<string, unknown>>;
  readonly sheets: Map<string, Record<string, unknown>>;
  readonly requests: RecordedRequest[];
  readonly sleeps: number[];
  /** Status for POSTs whose path starts with the key; default 200. */
  readonly postStatus: Map<string, number>;
  /** The user `currentuser.json` reports for the token. */
  readonly currentUser: { id: string };
  readonly client: AemClient;
  posts(): RecordedRequest[];
}

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createFakeAuthor(origin: string = SYNTHETIC_AEM_AUTHOR): FakeAuthor {
  const pages = new Map<string, Record<string, unknown>>();
  const sheets = new Map<string, Record<string, unknown>>();
  const requests: RecordedRequest[] = [];
  const sleeps: number[] = [];
  const postStatus = new Map<string, number>();
  const currentUser = { id: "demo-user@example-domain.invalid" };

  const fetch = (async (input: URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const path = `${url.pathname}${url.search}`;
    requests.push({ method, path, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "POST") {
      const status = [...postStatus.entries()].find(([prefix]) => path.startsWith(prefix))?.[1] ?? 200;
      return json(status, {});
    }
    if (url.pathname === "/libs/granite/csrf/token.json") {
      return json(200, { token: "csrf-demo" });
    }
    if (url.pathname === "/bin/querybuilder.json") {
      const root = url.searchParams.get("path") ?? "";
      const activated = [...pages.entries()]
        .filter(([p]) => p === root || p.startsWith(`${root}/`))
        .filter(([, body]) => body["cq:lastReplicationAction"] === "Activate" || body["cq:lastReplicationAction_publish"] === "Activate")
        .map(([p]) => ({ path: p }));
      return json(200, { total: activated.length, hits: url.searchParams.has("group.p.or") ? activated : [] });
    }
    if (url.pathname === "/libs/granite/security/currentuser.json") {
      return json(200, { authorizableId: currentUser.id, name: "Demo user" });
    }
    // Sheets and pages are both read as jcr:content.1.json; sheets are looked up first.
    const sheetHit = /^(.*)\/jcr:content\.1\.json$/.exec(url.pathname);
    if (sheetHit?.[1] !== undefined && sheets.has(sheetHit[1])) {
      return json(200, sheets.get(sheetHit[1]));
    }
    const page = /^(.*)\/jcr:content\.1\.json$/.exec(url.pathname);
    if (page?.[1] !== undefined) {
      const body = pages.get(page[1]);
      if (body === undefined) {
        return json(404);
      }
      // A recorded action always comes with its date on a real author.
      const dated = typeof body["cq:lastReplicationAction"] === "string" && body["cq:lastReplicated"] === undefined ? { "cq:lastReplicated": "2026-10-01" } : {};
      return json(200, { "jcr:primaryType": "cq:PageContent", ...dated, ...body });
    }
    return json(404);
  }) as unknown as typeof globalThis.fetch;

  const client = createAemClient({
    fetch,
    now: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    tokenProvider: tokenProvider(),
    origin,
  });

  return { pages, sheets, requests, sleeps, postStatus, currentUser, client, posts: () => requests.filter((r) => r.method === "POST") };
}
