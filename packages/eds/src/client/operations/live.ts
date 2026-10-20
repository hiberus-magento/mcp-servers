// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Bulk publish/unpublish (design.md, Decision 5 & 7). `/.helix/config` and
// `redirects.json` are always ignored by the Admin API for bulk writes;
// this module surfaces which submitted paths were ignored rather than
// silently dropping that information.
import type { HttpClient } from "../http.js";
import { sitePath } from "../paths.js";

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

export interface SetLiveStateResult {
  readonly job: JobRef;
  readonly links: { readonly self: string };
  readonly ignoredPaths: readonly string[];
}

interface SetLiveStateWire {
  readonly job: JobRef;
  readonly links: { readonly self: string };
  readonly ignoredPaths?: readonly string[];
}

export async function setLiveState(http: HttpClient, options: SetLiveStateOptions): Promise<SetLiveStateResult> {
  const ref = options.ref ?? "main";
  const path = sitePath({ resource: "live", org: options.org, site: options.site, ref, suffix: "*" });
  // The job envelope IS the result — without `links.self` the caller
  // cannot poll — so an empty body here is a failure, not a quiet success.
  const body = await http.readJson<SetLiveStateWire>({
    method: "POST",
    path,
    body: { paths: options.paths, state: options.state },
    label: "the bulk publish job",
  });
  return { job: body.job, links: body.links, ignoredPaths: body.ignoredPaths ?? [] };
}
