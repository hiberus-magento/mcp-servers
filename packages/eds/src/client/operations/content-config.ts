// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Index and sitemap definitions read + write (eds-client spec, "Content
// Configuration Read and Write"). With the configuration service these are
// YAML documents under `/config/{org}/sites/{site}/content/` and override any
// `helix-query.yaml` / `helix-sitemap.yaml` in the code repository. They are
// text on the wire, sent with `content-type: text/yaml`. A site that never had
// one answers 404: that is a state (`null`), not a failure. The contract
// creates with `PUT` and updates with `POST`, so the caller says which one.
import type { HttpClient } from "../http.js";
import type { SiteConfigParams } from "./site-config.js";

export const CONTENT_CONFIG_FILES = ["query.yaml", "sitemap.yaml"] as const;
export type ContentConfigFile = (typeof CONTENT_CONFIG_FILES)[number];

export interface ContentConfigParams extends SiteConfigParams {
  readonly file: ContentConfigFile;
}

export function contentConfigPath(params: ContentConfigParams): string {
  return `/config/${params.org}/sites/${params.site}/content/${params.file}`;
}

/** The document as text, unparsed, or `null` when the site has none. */
export async function getContentConfig(http: HttpClient, params: ContentConfigParams): Promise<string | null> {
  const response = await http.send({ method: "GET", path: contentConfigPath(params), label: params.file, expectedStatuses: [404] });
  if (response.status === 404) return null;
  return response.text();
}

export interface SetContentConfigOptions extends ContentConfigParams {
  readonly content: string;
  /** Whether the site already has the document: `POST` updates it, `PUT` creates it. */
  readonly exists: boolean;
}

export async function setContentConfig(http: HttpClient, options: SetContentConfigOptions): Promise<void> {
  await http.send({
    method: options.exists ? "POST" : "PUT",
    path: contentConfigPath(options),
    text: options.content,
    textType: "text/yaml",
    label: options.file,
  });
}
