// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Index operations (design.md, Decision 7; eds-write-surface design.md D1).
// The contract documents a bulk index `POST` with no body as "re-index
// every published resource", and its body schema has only `paths`. So the
// full-site branch sends exactly that bodyless POST — reachable only
// through the `confirmFullReindex: true` literal — and the paths branch
// sends exactly `{ paths }`. (The `{ scope }` bodies this module used to
// send were never in the contract.) Removal has no bulk form: one path at
// a time.
import type { HttpClient } from "../http.js";
import { sitePath } from "../paths.js";
import type { JobRef } from "./live.js";
import { writeContentPath, type ContentPathOptions, type WriteResult } from "./write-result.js";

export type ReindexRequest =
  | { readonly scope: "paths"; readonly paths: readonly [string, ...string[]] }
  | { readonly scope: "full-site"; readonly confirmFullReindex: true };

export interface ReindexOptions {
  readonly org: string;
  readonly site: string;
  readonly ref?: string;
  readonly request: ReindexRequest;
}

export interface ReindexResult {
  readonly job: JobRef;
  readonly links: { readonly self: string };
}


export async function reindex(http: HttpClient, options: ReindexOptions): Promise<ReindexResult> {
  const ref = options.ref ?? "main";
  const path = sitePath({ resource: "index", org: options.org, site: options.site, ref, suffix: "*" });
  // Like `setLiveState`, the job envelope is the whole result: without it
  // there is nothing to poll, so an empty body is a failure.
  const body = options.request.scope === "full-site" ? {} : { body: { paths: options.request.paths } };
  return http.readJson<ReindexResult>({ method: "POST", path, ...body, label: "the reindex job" });
}

export async function indexPath(http: HttpClient, options: ContentPathOptions): Promise<WriteResult> {
  return writeContentPath(http, "index", "POST", options);
}

export async function unindexPath(http: HttpClient, options: ContentPathOptions): Promise<WriteResult> {
  return writeContentPath(http, "index", "DELETE", options);
}
