// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Preview update/delete, one path or as a bulk job (eds-client spec,
// "Single-Path and Bulk Preview, Live and Index Operations"). Same shapes as
// `live.ts`: the bulk body is `{ paths }` or `{ paths, delete: true }`, and
// ignored paths are reported, never dropped.
import type { HttpClient } from "../http.js";
import { submitBulkJob, type BulkContentOptions, type BulkJobResult } from "./live.js";
import { writeContentPath, type ContentPathOptions, type WriteResult } from "./write-result.js";

export async function previewPath(http: HttpClient, options: ContentPathOptions): Promise<WriteResult> {
  return writeContentPath(http, "preview", "POST", options);
}

export async function unpreviewPath(http: HttpClient, options: ContentPathOptions): Promise<WriteResult> {
  return writeContentPath(http, "preview", "DELETE", options);
}

export async function previewBulk(http: HttpClient, options: BulkContentOptions): Promise<BulkJobResult> {
  return submitBulkJob(http, "preview", options);
}
