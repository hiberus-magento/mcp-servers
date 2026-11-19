// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain-JS packaging stubs have no declarations
import * as awsProfiles from "./aws-ssl-profiles.js";
// @ts-expect-error — plain-JS packaging stubs have no declarations
import * as iconv from "./iconv-lite.js";

describe("packaging-gate alias stubs of the database driver", () => {
  it("iconv-lite refuses to decode or encode, naming the charset and the way out", () => {
    expect(() => iconv.getDecoder("gbk")).toThrow(/"gbk" charset/);
    expect(() => iconv.getEncoder("gbk")).toThrow(/utf8mb4/);
    expect(new iconv.UnsupportedCharsetError("x").name).toBe("UnsupportedCharsetError");
  });

  it("aws-ssl-profiles carries no certificate, so a profile-based connection cannot verify anything it should not", () => {
    expect(awsProfiles.ca).toEqual([]);
  });
});
