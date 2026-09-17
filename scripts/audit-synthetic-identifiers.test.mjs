// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 13.3: fixtures/examples must use only
// synthetic organization, site, and domain identifiers — never a real
// customer or brand name, and never a real-looking business domain.
import { describe, expect, it } from "vitest";
import { hashIdentifier, listCandidateFiles, scanTextForBannedIdentifiers } from "./audit-synthetic-identifiers.mjs";

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

describe("known-identifier denylist (hashed)", () => {
  // The denylist is stored as hashes, never as plaintext: this repository is
  // public, so a file listing the customer names we must never publish would
  // itself publish them. Hashing lets the check ship in the open.
  const bannedHashes = new Set([hashIdentifier("northwind traders")]);

  it("flags a banned identifier written with a space", () => {
    const violations = scanTextForBannedIdentifiers("Data from Northwind Traders was used.\n", "doc.md", { bannedHashes });
    expect(violations.some((violation) => violation.rule === "known-identifier")).toBe(true);
  });

  it("flags the same identifier written with a hyphen", () => {
    const violations = scanTextForBannedIdentifiers("the northwind-traders-project-specific commands\n", "doc.md", { bannedHashes });
    expect(violations.some((violation) => violation.rule === "known-identifier")).toBe(true);
  });

  it("flags the same identifier written as one concatenated word", () => {
    const violations = scanTextForBannedIdentifiers("host: northwindtraders.internal\n", "doc.md", { bannedHashes });
    expect(violations.some((violation) => violation.rule === "known-identifier")).toBe(true);
  });

  it("never echoes the matched identifier, so CI logs of a public repo stay clean", () => {
    const violations = scanTextForBannedIdentifiers("Northwind Traders\n", "doc.md", { bannedHashes });
    const hit = violations.find((violation) => violation.rule === "known-identifier");
    expect(hit).toBeDefined();
    expect(JSON.stringify(hit).toLowerCase()).not.toContain("northwind");
  });

  it("does not flag unrelated text", () => {
    const violations = scanTextForBannedIdentifiers("acme-demo-org and acme-demo-site-eu\n", "doc.md", { bannedHashes });
    expect(violations.filter((violation) => violation.rule === "known-identifier")).toEqual([]);
  });
});

describe("audit scope", () => {
  it("scans planning artifacts and docs, not only fixtures", () => {
    // All three real leaks in this repository's history landed in openspec/
    // planning artifacts, which the original glob list never looked at.
    const scanned = listCandidateFiles();
    expect(scanned.some((file) => file.startsWith("openspec/"))).toBe(true);
    expect(scanned.some((file) => file.startsWith("docs/"))).toBe(true);
    expect(scanned.some((file) => file === "README.md")).toBe(true);
  });

  it("excludes node_modules, dist and turbo caches", () => {
    const scanned = listCandidateFiles();
    expect(scanned.some((file) => /node_modules|\/dist\/|\.turbo/.test(file))).toBe(false);
  });
});

describe("code files: property access is not a domain", () => {
  // Broadening this audit from 8 fixture files to every text file in the
  // repository put it in contact with ordinary source code, where `x.org`
  // is a property read and not a business domain. Flagging those would make
  // the check unusable, and an unusable check gets switched off.
  it("does not flag property access on a code file", () => {
    const text = "const site = options.org;\nreturn deps.org ?? params.org;\n";
    const violations = scanTextForBannedIdentifiers(text, "packages/eds/src/client/auth.ts");
    expect(violations.filter((v) => v.rule === "unrecognized-domain")).toEqual([]);
  });

  it("still flags a domain inside a string literal in a code file", () => {
    const text = 'const host = "customer-shop.example-tld.com";\n';
    const violations = scanTextForBannedIdentifiers(text, "packages/eds/src/client/http.ts");
    expect(violations.some((v) => v.rule === "unrecognized-domain")).toBe(true);
  });

  it("still flags a bare domain in prose, where there is no property access to confuse it with", () => {
    const text = "The backend runs at customer-shop.example-tld.com in production.\n";
    const violations = scanTextForBannedIdentifiers(text, "docs/notes.md");
    expect(violations.some((v) => v.rule === "unrecognized-domain")).toBe(true);
  });

  it("still applies the hashed denylist to code outside string literals", () => {
    const bannedHashes = new Set([hashIdentifier("northwind traders")]);
    const text = "const northwindTraders = 1;\n";
    const violations = scanTextForBannedIdentifiers(text, "packages/eds/src/client/auth.ts", { bannedHashes });
    expect(violations.some((v) => v.rule === "known-identifier")).toBe(true);
  });
});

describe(".cloud hostnames", () => {
  // Magento Cloud project hostnames are `<projectid>.magento.cloud`, so the
  // project identifier IS the subdomain. The domain rule's TLD list did not
  // include `cloud`, which made the single most likely leak shape in the
  // magento-cloud package invisible to this audit.
  it("flags a project-shaped subdomain of the vendor domain", () => {
    const violations = scanTextForBannedIdentifiers('const h = "abcd1234efgh.magento.cloud";\n', "probe.ts");
    expect(violations.some((v) => v.rule === "unrecognized-domain")).toBe(true);
  });

  it("does not flag the bare vendor domain, which docs legitimately name", () => {
    const violations = scanTextForBannedIdentifiers("See the Magento Cloud API at magento.cloud for details.\n", "docs/notes.md");
    expect(violations.filter((v) => v.rule === "unrecognized-domain")).toEqual([]);
  });

  it("does not flag the documented API host", () => {
    const violations = scanTextForBannedIdentifiers("Requests go to api.magento.cloud.\n", "docs/notes.md");
    expect(violations.filter((v) => v.rule === "unrecognized-domain")).toEqual([]);
  });
});
