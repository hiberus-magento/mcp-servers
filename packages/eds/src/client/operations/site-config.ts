// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Site configuration read + write (design.md, Decision 5). Existence is
// ALWAYS checked via an explicit `GET` before any `PUT` — never inferred
// from a caught `409` on the `PUT` itself, which is an assumption inherited
// from the old Python CLI and never confirmed by Adobe's docs.
import { readJsonBody, type HttpClient } from "../http.js";
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
  // The one read in this module that cannot use `readJson`: it asks for a
  // non-ok status via `expectedStatuses`, so it must branch on the
  // `Response` before any body is read. Once past that branch the document
  // is required — `cdnPresent: true` with nothing in `cdn` would be a lie.
  const context = {
    method: "GET" as const,
    path: `/config/${params.org}/sites/${params.site}/cdn.json`,
    label: "the CDN config",
  };
  const response = await http.send({ ...context, expectedStatuses: CDN_CONFIG_ABSENT_STATUSES });
  if (!response.ok) {
    return { present: false, config: undefined };
  }
  return { present: true, config: await readJsonBody(response, context) };
}

/**
 * Site doc + CDN config + effective config, three GETs (well under the
 * concurrency cap). Each carries a label, because when one of the three
 * fails the operator needs to know WHICH one — a bare status with no
 * document name is barely better than the JSON parse error this replaced.
 */
export async function getSiteConfig(http: HttpClient, params: SiteConfigParams): Promise<SiteConfigResult> {
  const [site, cdn, effective] = await Promise.all([
    http.readJson({ method: "GET", path: siteConfigPath(params.org, params.site), label: "the site document" }),
    getCdnConfig(http, params),
    http.readJson({
      method: "GET",
      path: sitePath({ resource: "status", org: params.org, site: params.site, ref: "main", suffix: "" }),
      label: "the effective config",
    }),
  ]);
  return { site, cdn: cdn.config, cdnPresent: cdn.present, effective };
}

export interface PutSiteConfigResult {
  readonly existed: boolean;
  /**
   * Whether the `PUT` answered with a body at all. A write is allowed to
   * succeed and say nothing (a `204`), and that is not the same as
   * answering with an empty document — never inferred from `response`
   * being falsy.
   */
  readonly hasResponse: boolean;
  /** `undefined` exactly when `hasResponse` is false. */
  readonly response?: unknown;
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

  const written = await http.readOptionalJson({ method: "PUT", path, body: config, label: "the site document" });
  return written.hasContent ? { existed, hasResponse: true, response: written.content } : { existed, hasResponse: false };
}
