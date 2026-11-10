// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Live cache purge (eds-client spec, "Cache Purge and Sitemap Rebuild"). One
// path per request: the contract has no bulk purge, and a caller purging
// several paths issues one request each.
import type { HttpClient } from "../http.js";
import { sitePath } from "../paths.js";
import { toWriteResult, type ContentPathOptions, type WriteResult } from "./write-result.js";

export async function purgeCache(http: HttpClient, options: ContentPathOptions): Promise<WriteResult> {
  const path = sitePath({ resource: "cache", org: options.org, site: options.site, ref: options.ref ?? "main", suffix: options.path });
  return toWriteResult(await http.readOptionalJson({ method: "POST", path, label: `the cache purge of ${options.path}` }));
}
