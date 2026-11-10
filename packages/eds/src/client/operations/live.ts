// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Publish/unpublish, one path or as a bulk job (design.md, Decision 5 & 7;
// eds-client spec, "Single-Path and Bulk Preview, Live and Index
// Operations"). `/.helix/config` and `redirects.json` are always ignored by
// the Admin API for bulk writes; this module surfaces which submitted paths
// were ignored rather than silently dropping that information.
//
// The bulk body is the contract's `{ paths, delete? }`. It used to be
// `{ paths, state }` — a field the contract does not have, so an
// "unpublished" request never said `delete: true` (eds-write-surface
// tasks.md 2.7b).
import type { HttpClient } from "../http.js";
import { sitePath } from "../paths.js";
import { writeContentPath, type ContentPathOptions, type WriteResult } from "./write-result.js";

export interface SetLiveStateOptions {
  readonly org: string;
  readonly site: string;
  readonly ref?: string;
  readonly paths: readonly [string, ...string[]];
  readonly state: "published" | "unpublished";
}

export interface JobRef {
  readonly name: string;
  readonly topic: string;
  readonly state: string;
}

/** A bulk content-bus job (`preview` or `live`), as it is submitted. */
export interface BulkJobResult {
  readonly job: JobRef;
  readonly links: { readonly self: string };
  readonly ignoredPaths: readonly string[];
}

export type SetLiveStateResult = BulkJobResult;

interface BulkJobWire {
  readonly job: JobRef;
  readonly links: { readonly self: string };
  readonly ignoredPaths?: readonly string[];
}

export interface BulkContentOptions {
  readonly org: string;
  readonly site: string;
  readonly ref?: string;
  readonly paths: readonly [string, ...string[]];
  /** `true` sends `delete: true`; `false` sends `{ paths }` alone. */
  readonly remove: boolean;
}

/** Shared with `preview.ts`: the two bulk jobs differ only in their resource. */
export async function submitBulkJob(http: HttpClient, resource: "preview" | "live", options: BulkContentOptions): Promise<BulkJobResult> {
  const path = sitePath({ resource, org: options.org, site: options.site, ref: options.ref ?? "main", suffix: "*" });
  // The job envelope IS the result — without `links.self` the caller
  // cannot poll — so an empty body here is a failure, not a quiet success.
  const body = await http.readJson<BulkJobWire>({
    method: "POST",
    path,
    body: options.remove ? { paths: options.paths, delete: true } : { paths: options.paths },
    label: `the bulk ${resource} job`,
  });
  return { job: body.job, links: body.links, ignoredPaths: body.ignoredPaths ?? [] };
}

export async function setLiveState(http: HttpClient, options: SetLiveStateOptions): Promise<SetLiveStateResult> {
  return submitBulkJob(http, "live", { ...options, remove: options.state === "unpublished" });
}

export async function publishPath(http: HttpClient, options: ContentPathOptions): Promise<WriteResult> {
  return writeContentPath(http, "live", "POST", options);
}

export async function unpublishPath(http: HttpClient, options: ContentPathOptions): Promise<WriteResult> {
  return writeContentPath(http, "live", "DELETE", options);
}
