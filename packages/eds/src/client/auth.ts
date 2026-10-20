// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// TokenProvider wiring surface, `mintApiKey`, and `authStatus` (design.md,
// Decision 6). `mintApiKey` returns a plain object — the client never
// renders anything, that is `cli.ts`'s job alone. `authStatus` probes
// read-only endpoints and never returns the token value in any shape.
import type { HttpClient } from "./http.js";
import { EdsError } from "./errors.js";

/**
 * EDS API keys are managed at the ORG level: `GET /config/{org}/apiKeys.json`
 * answers 200, while the site-level path this module used to post to
 * (`/config/{org}/sites/{site}/apiKeys.json`) answers 404. There is
 * therefore no `site` to pass — a site-scoped key does not live at a
 * site-scoped path.
 */
const apiKeysPath = (org: string): string => `/config/${org}/apiKeys.json`;

export interface MintApiKeyOptions {
  readonly org: string;
  readonly roles: readonly string[];
}

/**
 * One key's declared fields, as `GET /config/{org}/apiKeys.json` returns
 * them. Note `expiration` — NOT `expiresAt`, which this module used to
 * declare and no observed response has ever carried.
 */
export interface ApiKeyRecord {
  readonly id: string;
  readonly roles: readonly string[];
  readonly description?: string;
  readonly subject?: string;
  readonly expiration?: string;
  readonly created?: string;
}

export interface MintedApiKey extends ApiKeyRecord {
  /**
   * The secret itself. Declared OPTIONAL deliberately: only the LIST
   * response was observed live, and it carries no key value (the list is
   * keyed BY a secret-shaped string, which this module never reads). If a
   * create response puts the value somewhere this parser does not
   * recognise, the caller sees it is absent rather than being handed
   * `undefined` dressed up as a key.
   */
  readonly value?: string;
}

/** The only key metadata fields ever read, by name — never `{ ...raw }`. */
const OPTIONAL_RECORD_FIELDS = ["description", "subject", "expiration", "created"] as const;
type OptionalRecordField = (typeof OPTIONAL_RECORD_FIELDS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectApiKeyRecord(raw: unknown): ApiKeyRecord {
  const source = isRecord(raw) ? raw : {};
  const rawRoles = source["roles"];
  const known: { -readonly [K in OptionalRecordField]?: string } = {};
  for (const field of OPTIONAL_RECORD_FIELDS) {
    const value = source[field];
    if (typeof value === "string") {
      known[field] = value;
    }
  }
  return {
    id: typeof source["id"] === "string" ? source["id"] : "",
    roles: Array.isArray(rawRoles) ? rawRoles.filter((role): role is string => typeof role === "string") : [],
    ...known,
  };
}

export async function mintApiKey(http: HttpClient, options: MintApiKeyOptions): Promise<MintedApiKey> {
  const response = await http.send({ method: "POST", path: apiKeysPath(options.org), body: { roles: options.roles } });
  const body: unknown = await response.json();
  const record = projectApiKeyRecord(body);
  const value = isRecord(body) ? body["value"] : undefined;
  return typeof value === "string" ? { ...record, value } : record;
}

export interface ListApiKeysOptions {
  readonly org: string;
}

/**
 * Lists the org's API keys WITHOUT their key material. The response is an
 * object keyed by an opaque, secret-shaped string; only the VALUES are
 * read, field by field, so neither that key nor a `value` field can reach a
 * caller even if the API starts returning one (the same construction
 * `parseVariableList` uses in the magento-cloud package).
 *
 * CLI-only by design — key management has no MCP tool (eds-cli spec,
 * "CLI-Only Operations Excluded from MCP").
 */
export async function listApiKeys(http: HttpClient, options: ListApiKeysOptions): Promise<readonly ApiKeyRecord[]> {
  const response = await http.send({ method: "GET", path: apiKeysPath(options.org) });
  const body: unknown = await response.json();
  if (!isRecord(body)) {
    return [];
  }
  return Object.values(body).map(projectApiKeyRecord);
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
    // Reporting a non-ok status in plain English is this function's whole
    // job, and since `send()` now throws on 401/403/404 the verdict has to
    // come from the thrown error's status, not only from a returned
    // response — otherwise every rejected key reads as "unknown".
    if (error instanceof EdsError && error.status !== undefined) {
      return { path, status: error.status, verdict: verdictFor(error.status) };
    }
    return { path, status: 0, verdict: "unknown" };
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
