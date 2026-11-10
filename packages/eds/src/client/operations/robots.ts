// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `robots.txt` read + write (eds-client spec, "robots.txt Read and Write").
// The one site document that is plain text on the wire in both directions:
// it is read unparsed and written with `content-type: text/plain`, never
// JSON-encoded (which would send a quoted string with escaped newlines).
import type { HttpClient } from "../http.js";
import type { SiteConfigParams } from "./site-config.js";

export function robotsPath(params: SiteConfigParams): string {
  return `/config/${params.org}/sites/${params.site}/robots.txt`;
}

export async function getRobots(http: HttpClient, params: SiteConfigParams): Promise<string> {
  return http.readText({ method: "GET", path: robotsPath(params), label: "robots.txt" });
}

export interface SetRobotsOptions extends SiteConfigParams {
  readonly content: string;
}

export async function setRobots(http: HttpClient, options: SetRobotsOptions): Promise<void> {
  await http.send({ method: "POST", path: robotsPath(options), text: options.content, label: "robots.txt" });
}
