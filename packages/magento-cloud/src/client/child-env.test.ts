// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.1): the child environment is built from NAMED
// keys only — never a spread, never a direct `process.env` read
// (magento-cloud-client spec, "Explicit Child Environment Assembly").
import { describe, expect, it } from "vitest";
import { buildChildEnv } from "./child-env.js";

describe("buildChildEnv", () => {
  it("key set deep-equals exactly HOME, MAGENTO_CLOUD_CLI_TOKEN, PATH when a token is resolved", () => {
    const env = buildChildEnv({ token: "demo-tok-1", home: "/home/demo", path: "/usr/bin:/bin" });

    expect(Object.keys(env).sort()).toEqual(["HOME", "MAGENTO_CLOUD_CLI_TOKEN", "PATH"]);
    expect(env).toEqual({
      HOME: "/home/demo",
      MAGENTO_CLOUD_CLI_TOKEN: "demo-tok-1",
      PATH: "/usr/bin:/bin",
    });
  });

  it("omits MAGENTO_CLOUD_CLI_TOKEN entirely when no token is given — the auth_status exception (design.md, Decision 9)", () => {
    const env = buildChildEnv({ home: "/home/demo", path: "/usr/bin:/bin" });

    expect(Object.keys(env).sort()).toEqual(["HOME", "PATH"]);
  });

  it("never carries any key beyond the three named ones, even with an unusual home/path value", () => {
    const env = buildChildEnv({ token: "t", home: "/weird/HOME=injected", path: "/usr/bin" });

    expect(Object.keys(env).sort()).toEqual(["HOME", "MAGENTO_CLOUD_CLI_TOKEN", "PATH"]);
  });
});
