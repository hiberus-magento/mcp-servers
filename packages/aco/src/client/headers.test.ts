// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 1.11): admin requests carry Authorization + x-api-key
// and never an access-token header; an unprotected Merchandising request
// carries only AC-View-ID/AC-Scope-Locale and no credential-shaped header
// at all; a stub access-token supplier's header is attached exactly once
// per request (design.md, Decision 2).
import { describe, expect, it } from "vitest";
import { buildAdminHeaders, buildMerchandisingHeaders } from "./headers.js";

describe("buildAdminHeaders", () => {
  it("carries Authorization: Bearer <token> and x-api-key, and no access-token header", () => {
    const headers = buildAdminHeaders({ token: "test-only-admin-bearer", apiKey: "test-only-api-key" });

    expect(headers["Authorization"]).toBe("Bearer test-only-admin-bearer");
    expect(headers["x-api-key"]).toBe("test-only-api-key");
    expect(headers["AC-Catalog-View-Access-Token"]).toBeUndefined();
  });

  it("omits x-api-key and x-gw-ims-org-id when not configured", () => {
    const headers = buildAdminHeaders({ token: "test-only-admin-bearer" });

    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["x-gw-ims-org-id"]).toBeUndefined();
  });
});

describe("buildMerchandisingHeaders", () => {
  it("an unprotected view carries AC-View-ID and AC-Scope-Locale only, with no credential header", () => {
    const headers = buildMerchandisingHeaders({ viewId: "acv-demo-outdoor-gear-eu", locale: "en_US" });

    expect(headers["AC-View-ID"]).toBe("acv-demo-outdoor-gear-eu");
    expect(headers["AC-Scope-Locale"]).toBe("en_US");
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["AC-Catalog-View-Access-Token"]).toBeUndefined();
  });

  it("attaches the stub access-token supplier's value exactly once", () => {
    const headers = buildMerchandisingHeaders({
      viewId: "acv-demo-outdoor-gear-eu",
      locale: "en_US",
      catalogViewAccessToken: "test-only-access-token",
    });

    expect(headers["AC-Catalog-View-Access-Token"]).toBe("test-only-access-token");
    // Exactly once: the header value is not duplicated or comma-joined.
    expect(headers["AC-Catalog-View-Access-Token"]?.split(",")).toHaveLength(1);
  });

  it("carries an optional AC-Price-Book-ID only when supplied", () => {
    const withPriceBook = buildMerchandisingHeaders({ viewId: "v", locale: "en_US", priceBookId: "acpb-demo-eur" });
    const withoutPriceBook = buildMerchandisingHeaders({ viewId: "v", locale: "en_US" });

    expect(withPriceBook["AC-Price-Book-ID"]).toBe("acpb-demo-eur");
    expect(withoutPriceBook["AC-Price-Book-ID"]).toBeUndefined();
  });

  it("carries one AC-Policy-{name} header per configured policy", () => {
    const headers = buildMerchandisingHeaders({ viewId: "v", locale: "en_US", policies: { "restricted-catalog": "true" } });

    expect(headers["AC-Policy-restricted-catalog"]).toBe("true");
  });
});
