// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Site configuration read + write (design.md, Decision 5), site lifecycle
// and configuration versions (eds-write-surface). Existence is ALWAYS
// checked via an explicit `GET` before a create or an update — never
// inferred from a caught `409` on the write itself, which is an assumption
// inherited from the old Python CLI.
import { SiteExistenceError } from "../errors.js";
import { readJsonBody, type HttpClient } from "../http.js";
import { sitePath } from "../paths.js";
import { parseSiteList, type SiteListResult, type SiteListWire } from "../types.js";
import { toWriteResult, type WriteResult } from "./write-result.js";

export function siteConfigPath(org: string, site: string): string {
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

/**
 * The existence check both writes share. The one read in the client that
 * *asks* for a non-ok status: a 404 here is the answer "it does not exist",
 * not a failure. Every other status still becomes a named error.
 */
/** The site document alone — what `config.patch` diffs and fingerprints. `getSiteConfig` adds the CDN and effective config. */
export async function getSiteDocument(http: HttpClient, params: SiteConfigParams): Promise<unknown> {
  return http.readJson({ method: "GET", path: siteConfigPath(params.org, params.site), label: "the site document" });
}

export async function siteExists(http: HttpClient, params: SiteConfigParams): Promise<boolean> {
  const response = await http.send({ method: "GET", path: siteConfigPath(params.org, params.site), label: "the site document", expectedStatuses: [404] });
  return response.ok;
}

/**
 * The contract: `PUT` creates and answers 409 if the site exists. That 409
 * is never relied on — the `GET` decides (eds-client spec, "Config Write
 * Existence Check via GET-Before-Write"), and an existing site is an error
 * naming it, never a fall-through to an update.
 */
export async function createSite(http: HttpClient, params: SiteConfigParams, config: unknown): Promise<WriteResult> {
  if (await siteExists(http, params)) {
    throw new SiteExistenceError({ site: params.site, expected: "absent" });
  }
  return toWriteResult(await http.readOptionalJson({ method: "PUT", path: siteConfigPath(params.org, params.site), body: config, label: "the site document" }));
}

/**
 * The contract: `POST` "stores new site configuration" — it replaces the
 * document, so `config` is the whole document, not a patch. A missing site
 * is an error, never a fall-through to a create.
 */
export async function updateSiteConfig(http: HttpClient, params: SiteConfigParams, config: unknown): Promise<WriteResult> {
  if (!(await siteExists(http, params))) {
    throw new SiteExistenceError({ site: params.site, expected: "present" });
  }
  return toWriteResult(await http.readOptionalJson({ method: "POST", path: siteConfigPath(params.org, params.site), body: config, label: "the site document" }));
}

export async function deleteSite(http: HttpClient, params: SiteConfigParams): Promise<WriteResult> {
  return toWriteResult(await http.readOptionalJson({ method: "DELETE", path: siteConfigPath(params.org, params.site), label: "the site document" }));
}

export interface ListSitesOptions {
  readonly org: string;
}

export async function listSites(http: HttpClient, options: ListSitesOptions): Promise<SiteListResult> {
  return parseSiteList(await http.readJson<SiteListWire>({ method: "GET", path: `/config/${options.org}/sites.json`, label: "the site list" }));
}

/** As the contract documents it; `version` is a number there, but restore takes it as an opaque id. */
export interface ConfigVersion {
  readonly version: number | string;
  readonly created?: string;
  readonly name?: string;
}

export interface ConfigVersions {
  readonly current?: number | string;
  readonly versions: readonly ConfigVersion[];
}

export async function listConfigVersions(http: HttpClient, params: SiteConfigParams): Promise<ConfigVersions> {
  return http.readJson<ConfigVersions>({ method: "GET", path: `/config/${params.org}/sites/${params.site}/versions.json`, label: "the config versions" });
}

export interface RestoreConfigVersionOptions extends SiteConfigParams {
  readonly versionId: string;
}

/** Bodyless `POST` with the id in the query; encoded so an id can never add parameters of its own. */
export async function restoreConfigVersion(http: HttpClient, options: RestoreConfigVersionOptions): Promise<WriteResult> {
  const path = `${siteConfigPath(options.org, options.site)}?restoreVersion=${encodeURIComponent(options.versionId)}`;
  return toWriteResult(await http.readOptionalJson({ method: "POST", path, label: "the config version restore" }));
}
