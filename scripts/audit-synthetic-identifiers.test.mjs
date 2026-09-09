// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 13.3: fixtures/examples must use only
// synthetic organization, site, and domain identifiers — never a real
// customer or brand name, and never a real-looking business domain.
import { describe, expect, it } from "vitest";
import { scanTextForBannedIdentifiers } from "./audit-synthetic-identifiers.mjs";

describe("scanTextForBannedIdentifiers", () => {
  it("passes for content using only the declared synthetic constants", () => {
    const text = 'export const ORG = "acme-demo-org";\nexport const SITE = "acme-demo-site-eu";\n';
    const violations = scanTextForBannedIdentifiers(text, "fixture.ts");
    expect(violations).toEqual([]);
  });

  it("flags a real-looking business domain not on the safe-domains allowlist", () => {
    const text = 'const backendHost = "customer-example-shop.example-tld.com";\n';
    const violations = scanTextForBannedIdentifiers(text, "fixture.ts");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].file).toBe("fixture.ts");
    expect(violations[0].line).toBe(1);
  });

  it("flags a company-suffix pattern that looks like a real registered business name", () => {
    const text = "// Data originally sourced from Northwind Traders Inc.\n";
    const violations = scanTextForBannedIdentifiers(text, "fixture.ts");
    expect(violations.some((violation) => violation.rule === "company-suffix")).toBe(true);
  });

  it("does not flag known-safe domains (github.com, npmjs.com, modelcontextprotocol.io)", () => {
    const text = "See https://github.com/hiberus-magento/mcp-servers and https://modelcontextprotocol.io\n";
    const violations = scanTextForBannedIdentifiers(text, "fixture.ts");
    expect(violations).toEqual([]);
  });
});
