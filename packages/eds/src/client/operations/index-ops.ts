// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Reindex operation (design.md, Decision 7). Both branches of the
// discriminated request ALWAYS send an explicit JSON body — never a
// bodyless POST, which the old Python CLI's own behavior suggests would be
// silently interpreted as "index everything" (the same inferred-only
// pattern as the snapshot-POST hazard).
import type { HttpClient } from "../http.js";
import { sitePath } from "../paths.js";
import type { JobRef } from "./live.js";

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

function reindexBody(request: ReindexRequest): { scope: string; paths?: readonly string[] } {
  if (request.scope === "full-site") {
    return { scope: "full-site" };
  }
  return { scope: "paths", paths: request.paths };
}

export async function reindex(http: HttpClient, options: ReindexOptions): Promise<ReindexResult> {
  const ref = options.ref ?? "main";
  const path = sitePath({ resource: "index", org: options.org, site: options.site, ref, suffix: "*" });
  const response = await http.send({ method: "POST", path, body: reindexBody(options.request) });
  return (await response.json()) as ReindexResult;
}
