// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Track-separated header assembly (design.md, Decision 2). `AcoHeaderName`
// is a closed union that structurally EXCLUDES `X-Auth-Token` (EDS's
// header) — assigning through it is a `tsc` error. That holds only at this
// assembly function's boundary: `Headers` itself accepts any string, so a
// determined caller could still `set()` one downstream. A source-scan test
// (`purity.test.ts`) covers the rest of `packages/aco/src/**`. Type where
// knowable, scan where structural.
export type AcoHeaderName =
  | "Content-Type"
  | "Accept"
  | "Authorization"
  | "x-api-key"
  | "x-gw-ims-org-id"
  | "AC-View-ID"
  | "AC-Scope-Locale"
  | "AC-Price-Book-ID"
  | "AC-Catalog-View-Access-Token"
  | `AC-Policy-${string}`;

export type AcoHeaderRecord = Partial<Record<AcoHeaderName, string>>;

/** Resolves a per-request RS256-signed access token for a protected catalog view. Signing itself is deferred (design.md, Decision 2) — this is only the seam. */
export type CatalogViewAccessTokenSupplier = () => Promise<string> | string;

function setHeader(headers: AcoHeaderRecord, name: AcoHeaderName, value: string): void {
  headers[name] = value;
}

export interface AdminHeaderOptions {
  readonly token: string;
  readonly apiKey?: string;
  readonly imsOrgId?: string;
}

/**
 * The admin track's headers. `apiKey`/`imsOrgId` necessity is unconfirmed
 * against a real tenant (design.md, Open Questions) — sent when configured,
 * omitted when not.
 */
export function buildAdminHeaders(options: AdminHeaderOptions): AcoHeaderRecord {
  const headers: AcoHeaderRecord = {};
  setHeader(headers, "Content-Type", "application/json");
  setHeader(headers, "Accept", "application/json");
  setHeader(headers, "Authorization", `Bearer ${options.token}`);
  if (options.apiKey !== undefined) {
    setHeader(headers, "x-api-key", options.apiKey);
  }
  if (options.imsOrgId !== undefined) {
    setHeader(headers, "x-gw-ims-org-id", options.imsOrgId);
  }
  return headers;
}

export interface MerchandisingHeaderOptions {
  readonly viewId: string;
  readonly locale: string;
  readonly priceBookId?: string;
  /**
   * Absent by default (design.md, Decision 2). Per-request RS256 signing is
   * deferred — this parameter is the seam: when present it is attached
   * verbatim, no key-loading or signing machinery exists in this module.
   */
  readonly catalogViewAccessToken?: string;
  readonly policies?: Readonly<Record<string, string>>;
}

/**
 * The Merchandising track's headers. Unprotected by default: no
 * `catalogViewAccessToken` means no credential-shaped header is emitted at
 * all — an unprotected call carries only routing headers (`AC-View-ID`,
 * `AC-Scope-Locale`, and the optional `AC-Price-Book-ID`/`AC-Policy-*`).
 */
export function buildMerchandisingHeaders(options: MerchandisingHeaderOptions): AcoHeaderRecord {
  const headers: AcoHeaderRecord = {};
  setHeader(headers, "Content-Type", "application/json");
  setHeader(headers, "Accept", "application/json");
  setHeader(headers, "AC-View-ID", options.viewId);
  setHeader(headers, "AC-Scope-Locale", options.locale);
  if (options.priceBookId !== undefined) {
    setHeader(headers, "AC-Price-Book-ID", options.priceBookId);
  }
  if (options.catalogViewAccessToken !== undefined) {
    setHeader(headers, "AC-Catalog-View-Access-Token", options.catalogViewAccessToken);
  }
  if (options.policies !== undefined) {
    for (const [policyName, policyValue] of Object.entries(options.policies)) {
      setHeader(headers, `AC-Policy-${policyName}`, policyValue);
    }
  }
  return headers;
}
