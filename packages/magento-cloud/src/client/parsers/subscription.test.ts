// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSubscriptionInfo } from "./subscription.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseSubscriptionInfo", () => {
  it("maps subscription:info's single-row table into one record", () => {
    expect(parseSubscriptionInfo(readFixture("subscription-info.txt"))).toEqual({ plan: "standard", status: "active" });
  });
});
