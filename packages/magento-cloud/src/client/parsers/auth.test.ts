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
  // Every flat scalar the CLI emits is kept — the parser validates the keys
  // it requires and passes the rest through — and the leading
  // `Property`/`Value` header row is NOT one of them.
  it("maps auth:info's field/value rows, without the Property/Value header row", () => {
    expect(parseAuthInfo(readFixture("auth-info.txt"))).toEqual({
      id: "acct-demo-0001",
      first_name: "Demo",
      last_name: "User",
      username: "demo-user",
      email: "demo.user@example-domain",
      phone_number_verified: "false",
    });
  });

  it("POSITIVE CONTROL: output missing a required key still throws", () => {
    expect(() => parseAuthInfo("Property\tValue\nid\tacct-demo-0001\n")).toThrow(MagentoCloudOutputShapeError);
  });
});
