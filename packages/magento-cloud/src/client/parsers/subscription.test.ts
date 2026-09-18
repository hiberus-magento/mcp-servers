// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MagentoCloudOutputShapeError } from "../errors.js";
import { parseSubscriptionInfo } from "./subscription.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseSubscriptionInfo", () => {
  // CHANGED DELIBERATELY: this assertion used to list every flat scalar the
  // fixture carries, encoding the "pass the rest through" behaviour that let
  // `owner`, `mageId`, `members` and `project_ui` reach a caller. The parser
  // now projects an allowlist.
  //
  // `subscription:info` is still one of the CLI's KEY/VALUE commands — a
  // `Property`/`Value` header row followed by `field<TAB>value` pairs, with
  // nested blocks (`owner_info`) as indented continuation lines.
  it("maps subscription:info to its allowlisted fields, dropping every other key the CLI printed", () => {
    const subscription = parseSubscriptionInfo(readFixture("subscription-info.txt"));

    expect(subscription).toEqual({
      plan: "demo-plan",
      status: "active",
      id: "sub-demo-0001",
      environments: "3",
      storage: "51200",
      user_licenses: "5",
      project_region: "demo-region.example-domain",
      project_title: "Demo Storefront",
    });
    expect(subscription).not.toHaveProperty("owner");
    expect(subscription).not.toHaveProperty("owner_info");
    expect(subscription).not.toHaveProperty("mageId");
    expect(subscription).not.toHaveProperty("members");
    expect(subscription).not.toHaveProperty("project_ui");
    expect(subscription).not.toHaveProperty("Property");
  });

  it("POSITIVE CONTROL: output missing a required key still throws", () => {
    expect(() => parseSubscriptionInfo("Property\tValue\nstatus\tactive\n")).toThrow(MagentoCloudOutputShapeError);
  });
});

// A live smoke test confirmed `subscription:info` carries the owner's name and
// account, and a console URI identifying the organization.
const SUBSCRIPTION_INFO_UNDECLARED_PAIRS =
  "owner\tacct-DEMOOWNER\nproject_ui\thttps://console.demo-region.example-domain/acme/DEMOUIPATH\n";

const subscriptionInfoWithUndeclaredPairs = () => readFixture("subscription-info.txt") + SUBSCRIPTION_INFO_UNDECLARED_PAIRS;

describe("parseSubscriptionInfo — undeclared keys", () => {
  // The strongest proof here runs on the SERIALIZED result, not the in-memory
  // object: the narrow return type is a compile-time claim only.
  it("cannot leak an undeclared key even through JSON.stringify", () => {
    const serialized = JSON.stringify(parseSubscriptionInfo(subscriptionInfoWithUndeclaredPairs()));

    expect(serialized).not.toContain("owner");
    expect(serialized).not.toContain("DEMOOWNER");
    expect(serialized).not.toContain("project_ui");
    expect(serialized).not.toContain("DEMOUIPATH");
    expect(serialized).not.toContain("mageId");
    expect(serialized).not.toContain("members");
  });

  // POSITIVE CONTROL: the same probe must find every marker in the raw text.
  it("positive control: the same probe finds each dropped key in the raw CLI output", () => {
    const raw = subscriptionInfoWithUndeclaredPairs();

    expect(raw).toContain("owner");
    expect(raw).toContain("DEMOOWNER");
    expect(raw).toContain("project_ui");
    expect(raw).toContain("DEMOUIPATH");
    expect(raw).toContain("mageId");
    expect(raw).toContain("members");
  });
});
