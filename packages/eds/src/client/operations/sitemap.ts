// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Sitemap rebuild (eds-client spec, "Cache Purge and Sitemap Rebuild"). The
// contract answers 200 with the generated paths or 204 with nothing, so the
// body is optional.
import type { HttpClient } from "../http.js";
import { sitePath } from "../paths.js";
import { toWriteResult, type ContentPathOptions, type WriteResult } from "./write-result.js";

export async function rebuildSitemap(http: HttpClient, options: ContentPathOptions): Promise<WriteResult> {
  const path = sitePath({ resource: "sitemap", org: options.org, site: options.site, ref: options.ref ?? "main", suffix: options.path });
  return toWriteResult(await http.readOptionalJson({ method: "POST", path, label: `the sitemap ${options.path}` }));
}
