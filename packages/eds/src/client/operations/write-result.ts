// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The result shape every write that may answer without a body shares, and
// the one single-path content-bus write (`preview`, `live`, `index`) that
// three modules would otherwise each repeat.
import type { HttpClient, HttpMethod, OptionalJsonBody } from "../http.js";
import { sitePath } from "../paths.js";

/**
 * A successful write's response. A write is allowed to succeed and say
 * nothing (a `204`), and that is not the same as answering with an empty
 * document — never inferred from `response` being falsy.
 */
export interface WriteResult {
  readonly hasResponse: boolean;
  /** `undefined` exactly when `hasResponse` is false. */
  readonly response?: unknown;
}

export function toWriteResult(written: OptionalJsonBody): WriteResult {
  return written.hasContent ? { hasResponse: true, response: written.content } : { hasResponse: false };
}

export interface ContentPathOptions {
  readonly org: string;
  readonly site: string;
  readonly ref?: string;
  /** One content path, e.g. `/products/demo`. */
  readonly path: string;
}

/** `POST` (update) or `DELETE` (remove) on `/{resource}/{org}/{site}/{ref}/{path}`, never with a body. */
export async function writeContentPath(
  http: HttpClient,
  resource: "preview" | "live" | "index",
  method: Extract<HttpMethod, "POST" | "DELETE">,
  options: ContentPathOptions,
): Promise<WriteResult> {
  const path = sitePath({ resource, org: options.org, site: options.site, ref: options.ref ?? "main", suffix: options.path });
  return toWriteResult(await http.readOptionalJson({ method, path, label: `the ${resource} of ${options.path}` }));
}
