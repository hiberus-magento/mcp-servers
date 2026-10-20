// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Status queries — single-path (synchronous per-partition object) and bulk
// (design.md Decision 7).
//
// The bulk call was written as "POST, then poll the job". Observed live:
// the POST answers 200 with the job ALREADY finished
// (`job.data.phase === "completed"`) and every per-path result inline at
// `job.data.resources`, while the follow-up GET on the job's own
// `links.self` answers 404 `[AWS] Not Found` and
// `GET /job/{org}/{site}/{ref}/status` lists `jobs: []` — completed jobs
// are not retained, so that poll could not succeed for a request of that
// size. The results are therefore read inline whenever the response says
// the job completed. The polling path is KEPT, not deleted: only small
// requests were observed, and a large one plausibly does not finish
// synchronously. The boundary is the response's own `phase` field, never a
// guess about how many paths are "too many".
import type { HttpClient } from "../http.js";
import { sitePath } from "../paths.js";
import type { JobRef } from "./live.js";

export interface GetStatusOptions {
  readonly org: string;
  readonly site: string;
  readonly ref?: string;
  readonly path: string;
}

export interface StatusPartitions {
  readonly edit?: unknown;
  readonly preview?: unknown;
  readonly live?: unknown;
  readonly code?: unknown;
  readonly index?: unknown;
}

export async function getStatus(http: HttpClient, options: GetStatusOptions): Promise<StatusPartitions> {
  const ref = options.ref ?? "main";
  const path = sitePath({ resource: "status", org: options.org, site: options.site, ref, suffix: options.path });
  const response = await http.send({ method: "GET", path });
  return (await response.json()) as StatusPartitions;
}

export interface GetStatusBulkOptions {
  readonly org: string;
  readonly site: string;
  readonly ref?: string;
  readonly paths: readonly [string, ...string[]];
  readonly select?: readonly ("edit" | "preview" | "live")[];
}

/**
 * One entry of `job.data.resources`. These are the keys the live API was
 * observed to return, and this is NOT the single-path status shape: there
 * are no `preview.status` / `live.status` sub-objects to read here.
 */
export interface BulkStatusResource {
  readonly path: string;
  readonly previewLastModified?: string;
  readonly previewSourceLastModified?: string;
  readonly previewLastModifiedBy?: string;
  readonly publishLastModified?: string;
  readonly publishSourceLastModified?: string;
  readonly publishLastModifiedBy?: string;
}

export interface BulkStatusResults {
  readonly results: readonly BulkStatusResource[];
  /**
   * Requested paths that have no entry in `resources`. A path with no
   * content is simply absent from the response — that absence is the
   * answer the caller asked for, so it is named rather than dropped or
   * dressed up as a per-path 404.
   */
  readonly missingPaths: readonly string[];
}

export interface GetStatusBulkResult {
  readonly job: JobRef;
  readonly links: { readonly self: string };
  /** Present only when the response already carried a completed job. */
  readonly results?: readonly BulkStatusResource[];
  /** Present exactly when `results` is. */
  readonly missingPaths?: readonly string[];
}

/** The only keys ever read out of a resource entry, by name. */
const RESOURCE_FIELDS = [
  "previewLastModified",
  "previewSourceLastModified",
  "previewLastModifiedBy",
  "publishLastModified",
  "publishSourceLastModified",
  "publishLastModifiedBy",
] as const;
type ResourceField = (typeof RESOURCE_FIELDS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Field by field, by name — never `{ ...raw }`, so a key this projection
 * does not know about cannot reach a caller (and a 200-path response does
 * not drag the whole job payload through the tool result twice).
 */
function projectResource(raw: unknown): BulkStatusResource | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const path = raw["path"];
  if (typeof path !== "string" || path.length === 0) {
    return undefined;
  }
  const known: { -readonly [K in ResourceField]?: string } = {};
  for (const field of RESOURCE_FIELDS) {
    const value = raw[field];
    if (typeof value === "string") {
      known[field] = value;
    }
  }
  return { path, ...known };
}

/**
 * Reads the per-path results out of a bulk-status job, or `undefined` when
 * the job has not completed — in which case the caller still has to poll.
 *
 * Exported because the polling path needs the identical reading: once a
 * poll does return a completed job, its results arrive in the same place.
 *
 * A `resources` array it cannot fully attribute (an entry that is not an
 * object, or carries no path) yields `undefined` rather than a partial,
 * plausible-looking answer: a caller that then polls a retired job gets a
 * loud 404, which is the better failure.
 */
export function readBulkStatusResults(job: unknown, requestedPaths: readonly string[]): BulkStatusResults | undefined {
  if (!isRecord(job)) {
    return undefined;
  }
  const data = job["data"];
  if (!isRecord(data) || data["phase"] !== "completed") {
    return undefined;
  }
  const rawResources = data["resources"];
  if (!Array.isArray(rawResources)) {
    return undefined;
  }
  const results: BulkStatusResource[] = [];
  for (const entry of rawResources) {
    const projected = projectResource(entry);
    if (projected === undefined) {
      return undefined;
    }
    results.push(projected);
  }
  const present = new Set(results.map((resource) => resource.path));
  return { results, missingPaths: requestedPaths.filter((path) => !present.has(path)) };
}

function projectJobRef(job: unknown): JobRef {
  const raw = isRecord(job) ? job : {};
  return { name: stringOr(raw["name"], ""), topic: stringOr(raw["topic"], ""), state: stringOr(raw["state"], "") };
}

export async function getStatusBulk(http: HttpClient, options: GetStatusBulkOptions): Promise<GetStatusBulkResult> {
  const ref = options.ref ?? "main";
  const path = sitePath({ resource: "status", org: options.org, site: options.site, ref, suffix: "*" });
  const body: { paths: readonly string[]; select?: readonly string[] } =
    options.select !== undefined ? { paths: options.paths, select: options.select } : { paths: options.paths };
  const response = await http.send({ method: "POST", path, body });
  const wire: unknown = await response.json();
  const job = isRecord(wire) ? wire["job"] : undefined;
  const links = isRecord(wire) && isRecord(wire["links"]) ? wire["links"] : {};
  const base = { job: projectJobRef(job), links: { self: stringOr(links["self"], "") } };
  const finished = readBulkStatusResults(job, options.paths);
  return finished === undefined ? base : { ...base, results: finished.results, missingPaths: finished.missingPaths };
}
