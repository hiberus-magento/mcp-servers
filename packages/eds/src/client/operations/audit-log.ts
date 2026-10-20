// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Audit log — the sole paginable endpoint in this domain (design.md,
// Decision 5). Passes `since`/`nextToken` through verbatim and returns
// exactly one page; the caller decides whether to continue.
import type { HttpClient } from "../http.js";
import type { Page } from "../cursor.js";

export interface GetAuditLogOptions {
  readonly org: string;
  readonly site: string;
  readonly ref?: string;
  readonly since?: string;
  readonly nextToken?: string;
  readonly limit?: number;
}

export interface AuditLogEntry {
  readonly [key: string]: unknown;
}

function buildQuery(options: GetAuditLogOptions): string {
  const params = new URLSearchParams();
  if (options.since !== undefined) {
    params.set("since", options.since);
  }
  if (options.nextToken !== undefined) {
    params.set("nextToken", options.nextToken);
  }
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  const query = params.toString();
  return query.length > 0 ? `?${query}` : "";
}

export async function getAuditLog(http: HttpClient, options: GetAuditLogOptions): Promise<Page<AuditLogEntry>> {
  const ref = options.ref ?? "main";
  const path = `/log/${options.org}/${options.site}/${ref}${buildQuery(options)}`;
  const body = await http.readJson<Page<AuditLogEntry>>({ method: "GET", path, label: "the audit log page" });
  return body.nextToken !== undefined ? { entries: body.entries, nextToken: body.nextToken } : { entries: body.entries };
}
