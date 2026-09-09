// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// TokenProvider wiring surface, `mintApiKey`, and `authStatus` (design.md,
// Decision 6). `mintApiKey` returns a plain object — the client never
// renders anything, that is `cli.ts`'s job alone. `authStatus` probes
// read-only endpoints and never returns the token value in any shape.
import type { HttpClient } from "./http.js";
import { EdsError } from "./errors.js";

export interface MintApiKeyOptions {
  readonly org: string;
  readonly site: string;
  readonly roles: readonly string[];
}

export interface MintedApiKey {
  readonly id: string;
  readonly value: string;
  readonly roles: readonly string[];
  readonly expiresAt: string;
}

export async function mintApiKey(http: HttpClient, options: MintApiKeyOptions): Promise<MintedApiKey> {
  const path = `/config/${options.org}/sites/${options.site}/apiKeys.json`;
  const response = await http.send({ method: "POST", path, body: { roles: options.roles } });
  return (await response.json()) as MintedApiKey;
}

export interface AuthStatusOptions {
  readonly org: string;
  readonly site?: string;
}

export type ProbeVerdict = "reachable" | "key rejected (401)" | "key lacks the required role (403)" | "org or site not found (404)" | "unknown";

export interface AuthProbeResult {
  readonly path: string;
  readonly status: number;
  readonly verdict: ProbeVerdict;
}

export interface AuthStatusResult {
  readonly probes: readonly AuthProbeResult[];
}

function verdictFor(status: number): ProbeVerdict {
  if (status >= 200 && status < 300) {
    return "reachable";
  }
  if (status === 401) {
    return "key rejected (401)";
  }
  if (status === 403) {
    return "key lacks the required role (403)";
  }
  if (status === 404) {
    return "org or site not found (404)";
  }
  return "unknown";
}

async function probe(http: HttpClient, path: string): Promise<AuthProbeResult> {
  try {
    const response = await http.send({ method: "GET", path });
    return { path, status: response.status, verdict: verdictFor(response.status) };
  } catch (error) {
    const status = error instanceof EdsError && error.status !== undefined ? error.status : 0;
    return { path, status, verdict: "unknown" };
  }
}

/**
 * Probes `GET /config/{org}.json`, `GET /config/{org}/sites.json`, and —
 * when a site is configured — `GET /status/{org}/{site}/main/`. Reports the
 * path (never the token), the HTTP status, and a plain-English verdict.
 */
export async function authStatus(http: HttpClient, options: AuthStatusOptions): Promise<AuthStatusResult> {
  const orgConfigPath = `/config/${options.org}.json`;
  const sitesListPath = `/config/${options.org}/sites.json`;
  const probePaths = [orgConfigPath, sitesListPath];
  if (options.site !== undefined) {
    probePaths.push(`/status/${options.org}/${options.site}/main/`);
  }
  const probes = await Promise.all(probePaths.map((path) => probe(http, path)));
  return { probes };
}
