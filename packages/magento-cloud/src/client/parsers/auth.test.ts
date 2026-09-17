// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 6.1-6.2).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAuthInfo } from "./auth.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../test/fake-bin/fixtures");
const readFixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), "utf8");

describe("parseAuthInfo", () => {
  it("maps auth:info's field/value rows", () => {
    expect(parseAuthInfo(readFixture("auth-info.txt"))).toEqual({
      id: "acct-demo-0001",
      email: "demo.user@example-domain",
      username: "demo-user",
    });
  });
});
