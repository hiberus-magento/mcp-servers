// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Status queries — single-path (synchronous per-partition object) and bulk
// (a job envelope for `waitForJob` to poll), design.md Decision 7.
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

export interface GetStatusBulkResult {
  readonly job: JobRef;
  readonly links: { readonly self: string };
}

export async function getStatusBulk(http: HttpClient, options: GetStatusBulkOptions): Promise<GetStatusBulkResult> {
  const ref = options.ref ?? "main";
  const path = sitePath({ resource: "status", org: options.org, site: options.site, ref, suffix: "*" });
  const body: { paths: readonly string[]; select?: readonly string[] } =
    options.select !== undefined ? { paths: options.paths, select: options.select } : { paths: options.paths };
  const response = await http.send({ method: "POST", path, body });
  return (await response.json()) as GetStatusBulkResult;
}
