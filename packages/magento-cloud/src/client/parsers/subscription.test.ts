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
  // Despite this parser's previous header+row assumption, `subscription:info`
  // is one of the CLI's KEY/VALUE commands: a `Property`/`Value` header row
  // followed by `field<TAB>value` pairs, with nested blocks (`owner_info`)
  // rendered as indented continuation lines.
  it("maps subscription:info's field/value rows, ignoring the header row and every nested block", () => {
    const subscription = parseSubscriptionInfo(readFixture("subscription-info.txt"));

    expect(subscription).toEqual({
      id: "sub-demo-0001",
      status: "active",
      created_at: "2026-01-01T00:00:00+00:00",
      updated_at: "2026-01-02T00:00:00+00:00",
      owner: "acct-demo-0001",
      mageId: "mage-demo-0001",
      members: "3",
      project_id: "acme-demo-project",
      project_title: "Demo Storefront",
      default_branch: "main",
      project_region_label: "Demo Region",
      project_ui: "https://console.demo-region.example-domain/acme/acme-demo-project",
      plan: "demo-plan",
      environments: "3",
      storage: "51200",
      user_licenses: "5",
      project_region: "demo-region.example-domain",
      resources_limit: "0",
    });
    expect(subscription).not.toHaveProperty("owner_info");
    expect(subscription).not.toHaveProperty("Property");
  });

  it("POSITIVE CONTROL: output missing a required key still throws", () => {
    expect(() => parseSubscriptionInfo("Property\tValue\nstatus\tactive\n")).toThrow(MagentoCloudOutputShapeError);
  });
});
