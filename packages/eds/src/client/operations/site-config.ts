// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Site configuration read + write (design.md, Decision 5). Existence is
// ALWAYS checked via an explicit `GET` before any `PUT` — never inferred
// from a caught `409` on the `PUT` itself, which is an assumption inherited
// from the old Python CLI and never confirmed by Adobe's docs.
import type { HttpClient } from "../http.js";
import { sitePath } from "../paths.js";

function siteConfigPath(org: string, site: string): string {
  return `/config/${org}/sites/${site}.json`;
}

export interface SiteConfigParams {
  readonly org: string;
  readonly site: string;
}

export interface SiteConfigResult {
  readonly site: unknown;
  readonly cdn: unknown;
  readonly effective: unknown;
}

/** Site doc + CDN config + effective config, three GETs (well under the concurrency cap). */
export async function getSiteConfig(http: HttpClient, params: SiteConfigParams): Promise<SiteConfigResult> {
  const [site, cdn, effective] = await Promise.all([
    http.send({ method: "GET", path: siteConfigPath(params.org, params.site) }).then((r) => r.json()),
    http.send({ method: "GET", path: `/config/${params.org}/sites/${params.site}/cdn/config.json` }).then((r) => r.json()),
    http.send({ method: "GET", path: sitePath({ resource: "status", org: params.org, site: params.site, ref: "main", suffix: "" }) }).then((r) => r.json()),
  ]);
  return { site, cdn, effective };
}

export interface PutSiteConfigResult {
  readonly existed: boolean;
  readonly response: unknown;
}

/**
 * A first pass here caught an HTTP 409 from the `PUT` as its existence
 * check instead of issuing a `GET` first — `site-config.test.ts` failed
 * against it (no GET was ever recorded before the PUT) before being fixed
 * to the GET-then-PUT sequence below. The GET result alone decides whether
 * the site already existed; the PUT's own status is never consulted for
 * that purpose.
 */
export async function putSiteConfig(http: HttpClient, params: SiteConfigParams, config: unknown): Promise<PutSiteConfigResult> {
  const path = siteConfigPath(params.org, params.site);
  const existenceCheck = await http.send({ method: "GET", path });
  const existed = existenceCheck.ok;

  const response = await http.send({ method: "PUT", path, body: config });
  const body = await response.json();
  return { existed, response: body };
}
