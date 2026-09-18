// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MagentoCloudOutputShapeError } from "../errors.js";
import { parseAuthInfo } from "./auth.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseAuthInfo", () => {
  // CHANGED DELIBERATELY: this assertion used to claim "every flat scalar the
  // CLI emits is kept", which is what carried a real person's name into an
  // agent's context. The parser now projects an allowlist — the leading
  // `Property`/`Value` header row is still not data either.
  it("maps auth:info to its allowlisted fields, dropping the account holder's name", () => {
    const account = parseAuthInfo(readFixture("auth-info.txt"));

    expect(account).toEqual({
      id: "acct-demo-0001",
      username: "demo-user",
      email: "demo.user@example-domain",
    });
    expect(account).not.toHaveProperty("first_name");
    expect(account).not.toHaveProperty("last_name");
    expect(account).not.toHaveProperty("phone_number_verified");
    expect(account).not.toHaveProperty("Property");
  });

  it("POSITIVE CONTROL: output missing a required key still throws", () => {
    expect(() => parseAuthInfo("Property\tValue\nid\tacct-demo-0001\n")).toThrow(MagentoCloudOutputShapeError);
  });
});

// A live smoke test confirmed `auth:info` carries a person's given and family
// name. The probe appends them again under obviously-synthetic markers, so a
// leak is unambiguous rather than a coincidence of the fixture's wording.
const AUTH_INFO_UNDECLARED_PAIRS = "first_name\tDEMOGIVENNAME\nlast_name\tDEMOFAMILYNAME\nphone_number_verified\ttrue\n";

const authInfoWithUndeclaredPairs = () => readFixture("auth-info.txt") + AUTH_INFO_UNDECLARED_PAIRS;

describe("parseAuthInfo — undeclared keys", () => {
  // The strongest proof here runs on the SERIALIZED result, not the in-memory
  // object: the narrow return type is a compile-time claim only.
  it("cannot leak an undeclared key even through JSON.stringify", () => {
    const serialized = JSON.stringify(parseAuthInfo(authInfoWithUndeclaredPairs()));

    expect(serialized).not.toContain("first_name");
    expect(serialized).not.toContain("DEMOGIVENNAME");
    expect(serialized).not.toContain("last_name");
    expect(serialized).not.toContain("DEMOFAMILYNAME");
    expect(serialized).not.toContain("phone_number_verified");
  });

  // POSITIVE CONTROL: the same probe must find every marker in the raw text.
  it("positive control: the same probe finds each dropped key in the raw CLI output", () => {
    const raw = authInfoWithUndeclaredPairs();

    expect(raw).toContain("first_name");
    expect(raw).toContain("DEMOGIVENNAME");
    expect(raw).toContain("last_name");
    expect(raw).toContain("DEMOFAMILYNAME");
    expect(raw).toContain("phone_number_verified");
  });
});
