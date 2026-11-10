// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Shared test wiring for an author behind `FetchDouble`: synthetic origin,
// a static token provider and a recording `sleep`. Test-only; lives outside
// `client/` so the client-purity scan never counts it.
import type { TokenProvider } from "@hiberus-magento/mcp-core";
import { createAemClient, type AemClient, type AuthorHttp } from "../client/index.js";
import { SYNTHETIC_AEM_AUTHOR, SYNTHETIC_AEM_CONTENT_ROOT } from "@hiberus-magento/mcp-testing";
import { createFetchDouble, type FetchDouble, type RouteTable } from "./fetch-double.js";

export { SYNTHETIC_AEM_AUTHOR };
export const SYNTHETIC_ROOT: string = SYNTHETIC_AEM_CONTENT_ROOT;
export const SYNTHETIC_TOKEN = "aem-demo-token";
export const CSRF_ROUTE = "GET /libs/granite/csrf/token.json";

export function tokenProvider(value: string = SYNTHETIC_TOKEN): TokenProvider {
  return {
    domain: "aem-sites-stage",
    getToken: async () => ({ kind: "static" as const, value }),
    invalidate: () => undefined,
    describeRemedy: () => ({
      domain: "aem-sites-stage",
      cliCommand: "hiberus-aem-sites auth token set --env stage",
      envVar: "AEM_TOKEN_STAGE",
      configPath: "/dev/null",
      reason: "not found",
    }),
  };
}

export interface AuthorDouble extends FetchDouble {
  readonly http: AuthorHttp;
  readonly client: AemClient;
  readonly sleeps: number[];
}

export function createAuthorDouble(routes: RouteTable, options?: { readonly now?: () => number }): AuthorDouble {
  const double = createFetchDouble({ [CSRF_ROUTE]: { status: 200, body: { token: "csrf-demo" } }, ...routes });
  const sleeps: number[] = [];
  const client = createAemClient({
    fetch: double.fetch,
    now: options?.now ?? (() => 0),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    tokenProvider: tokenProvider(),
    origin: SYNTHETIC_AEM_AUTHOR,
  });
  return { ...double, http: client.http, client, sleeps };
}
