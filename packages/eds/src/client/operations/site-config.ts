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
  /** `undefined` exactly when `cdnPresent` is false. */
  readonly cdn: unknown;
  /** Whether the site has a CDN configuration document at all — never inferred from `cdn` being falsy. */
  readonly cdnPresent: boolean;
  readonly effective: unknown;
}

/**
 * The statuses that mean "this site has no CDN configuration document",
 * as opposed to "the request for it failed". 404 is the only status that
 * says absence under HTTP's own semantics, so it is the only member.
 *
 * This tenant's Admin API answers the CDN config path with 400 and a
 * zero-byte body. A 400 is "the server rejected this request", not
 * "the document does not exist", so it is deliberately NOT here and fails
 * loudly naming the document. If Adobe confirms 400 is how this endpoint
 * reports absence, adding `400` to this array is the whole change.
 */
const CDN_CONFIG_ABSENT_STATUSES: readonly number[] = [404];

interface CdnConfigLookup {
  readonly present: boolean;
  readonly config: unknown;
}

// `/cdn.json`, not `/cdn/config.json`. The latter was never a real endpoint:
// against the live Admin API it answers 400 with
// `x-error: "[admin] Error reading config: invalid object path."` — byte for
// byte the same answer a deliberately nonsensical path gets. Absence is 404
// there, proven by requesting the same document for a site that does not
// exist, so the 400 was never "this site has no CDN config" either. We had
// simply invented the path, and the JSON parse error that reached the
// operator hid it.
async function getCdnConfig(http: HttpClient, params: SiteConfigParams): Promise<CdnConfigLookup> {
  const response = await http.send({
    method: "GET",
    path: `/config/${params.org}/sites/${params.site}/cdn.json`,
    label: "the CDN config",
    expectedStatuses: CDN_CONFIG_ABSENT_STATUSES,
  });
  if (!response.ok) {
    return { present: false, config: undefined };
  }
  return { present: true, config: await response.json() };
}

/**
 * Site doc + CDN config + effective config, three GETs (well under the
 * concurrency cap). Each carries a label, because when one of the three
 * fails the operator needs to know WHICH one — a bare status with no
 * document name is barely better than the JSON parse error this replaced.
 */
export async function getSiteConfig(http: HttpClient, params: SiteConfigParams): Promise<SiteConfigResult> {
  const [site, cdn, effective] = await Promise.all([
    http.send({ method: "GET", path: siteConfigPath(params.org, params.site), label: "the site document" }).then((r) => r.json()),
    getCdnConfig(http, params),
    http
      .send({
        method: "GET",
        path: sitePath({ resource: "status", org: params.org, site: params.site, ref: "main", suffix: "" }),
        label: "the effective config",
      })
      .then((r) => r.json()),
  ]);
  return { site, cdn: cdn.config, cdnPresent: cdn.present, effective };
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
  // The one request in the client that *asks* for a non-ok status: a 404
  // here is the answer "it does not exist yet", not a failure. Every other
  // status still becomes a named error rather than a silent `existed: false`.
  const existenceCheck = await http.send({ method: "GET", path, label: "the site document", expectedStatuses: [404] });
  const existed = existenceCheck.ok;

  const response = await http.send({ method: "PUT", path, body: config });
  const body = await response.json();
  return { existed, response: body };
}
