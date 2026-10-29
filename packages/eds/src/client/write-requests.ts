// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Every Admin API write the MCP surface can plan, built as a
// `PlannedRequest` WITHOUT sending it (eds-write-surface design.md,
// Decision 1's operation table). `eds_plan` records these; `eds_apply`
// replays them through `sendPlannedRequest`. `write-requests.test.ts`
// proves each builder equals what its typed twin (the function the CLI
// calls) puts on the wire, so the two cannot drift apart.
import { codePath, sitePath, snapshotPath } from "./paths.js";
import type { PlannedRequest } from "./planned-request.js";
import type { CodePathParams } from "./operations/code.js";
import type { RestoreConfigVersionOptions, SiteConfigParams } from "./operations/site-config.js";
import { siteConfigPath } from "./operations/site-config.js";
import { robotsPath, type SetRobotsOptions } from "./operations/robots.js";
import type { GetJobStatusOptions } from "./jobs.js";
import type { AddToSnapshotOptions, RemoveFromSnapshotOptions, ReviewSnapshotOptions, SnapshotRef } from "./operations/snapshots.js";

type WriteMethod = PlannedRequest["method"];

export interface ContentAddress {
  readonly org: string;
  readonly site: string;
  readonly ref: string;
  /** One content path, e.g. `/products/demo`. */
  readonly path: string;
}

export interface BulkAddress {
  readonly org: string;
  readonly site: string;
  readonly ref: string;
  readonly paths: readonly string[];
}

const BULK_SUFFIX = "*";

function bulkPath(resource: string, address: Omit<BulkAddress, "paths">): string {
  return sitePath({ resource, org: address.org, site: address.site, ref: address.ref, suffix: BULK_SUFFIX });
}

export const writeRequests = {
  siteUpdate: (params: SiteConfigParams, document: unknown): PlannedRequest => ({ method: "POST", path: siteConfigPath(params.org, params.site), body: document }),
  siteCreate: (params: SiteConfigParams, document: unknown): PlannedRequest => ({ method: "PUT", path: siteConfigPath(params.org, params.site), body: document }),
  siteDelete: (params: SiteConfigParams): PlannedRequest => ({ method: "DELETE", path: siteConfigPath(params.org, params.site) }),
  versionRestore: (options: RestoreConfigVersionOptions): PlannedRequest => ({
    method: "POST",
    path: `${siteConfigPath(options.org, options.site)}?restoreVersion=${encodeURIComponent(options.versionId)}`,
  }),
  robotsSet: (options: SetRobotsOptions): PlannedRequest => ({ method: "POST", path: robotsPath(options), text: options.content }),

  /** `POST` (update) or `DELETE` (remove) on one preview/live/index path, never with a body. */
  contentPath: (resource: "preview" | "live" | "index", method: Extract<WriteMethod, "POST" | "DELETE">, address: ContentAddress): PlannedRequest => ({
    method,
    path: sitePath({ resource, org: address.org, site: address.site, ref: address.ref, suffix: address.path }),
  }),
  /** The bulk preview/live job: `{ paths }`, or `{ paths, delete: true }` to remove. */
  contentBulk: (resource: "preview" | "live", options: BulkAddress & { readonly remove: boolean }): PlannedRequest => ({
    method: "POST",
    path: bulkPath(resource, options),
    body: options.remove ? { paths: options.paths, delete: true } : { paths: options.paths },
  }),
  /** Reindex of named paths: exactly `{ paths }` (D1). */
  indexBulk: (options: BulkAddress): PlannedRequest => ({ method: "POST", path: bulkPath("index", options), body: { paths: options.paths } }),
  /** The contract's full-site reindex: the bulk index `POST` with no body (D1). */
  indexFullSite: (address: Omit<BulkAddress, "paths">): PlannedRequest => ({ method: "POST", path: bulkPath("index", address) }),
  cachePurge: (address: ContentAddress): PlannedRequest => ({
    method: "POST",
    path: sitePath({ resource: "cache", org: address.org, site: address.site, ref: address.ref, suffix: address.path }),
  }),
  sitemapRebuild: (address: ContentAddress): PlannedRequest => ({
    method: "POST",
    path: sitePath({ resource: "sitemap", org: address.org, site: address.site, ref: address.ref, suffix: address.path }),
  }),

  code: (method: Extract<WriteMethod, "POST" | "DELETE">, params: CodePathParams): PlannedRequest => ({
    method,
    path: codePath({ owner: params.owner, repo: params.repo, ref: params.ref ?? "main", file: params.path }),
  }),
  jobStop: (options: GetJobStatusOptions): PlannedRequest => ({
    method: "DELETE",
    path: sitePath({ resource: "job", org: options.org, site: options.site, ref: options.ref ?? "main", suffix: `${options.topic}/${options.name}` }),
  }),

  // Snapshot writes always carry an explicit JSON body (see `snapshots.ts`).
  snapshotAdd: (options: AddToSnapshotOptions): PlannedRequest => ({ method: "POST", path: snapshotPath(options), body: { paths: options.paths ?? [] } }),
  snapshotRemove: (options: RemoveFromSnapshotOptions): PlannedRequest => ({
    method: "POST",
    path: `${snapshotPath(options)}/remove`,
    body: { paths: options.paths },
  }),
  snapshotPublish: (ref: SnapshotRef): PlannedRequest => ({ method: "POST", path: `${snapshotPath(ref)}/publish`, body: {} }),
  snapshotReview: (options: ReviewSnapshotOptions): PlannedRequest => ({
    method: "POST",
    path: `${snapshotPath(options)}/review`,
    body: { reviewAction: options.reviewAction, message: options.message ?? "" },
  }),
  snapshotDelete: (ref: SnapshotRef): PlannedRequest => ({ method: "DELETE", path: snapshotPath(ref), body: {} }),
} as const;
