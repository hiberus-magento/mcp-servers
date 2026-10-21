// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Both outcomes of the build-time version injection, at the unit layer.
// The artifact-layer proof — that the version a BUILT server announces over
// `initialize` is the version in its own `package.json` — is the shared
// conformance suite's `checkAnnouncedVersion` assertion, which every server
// package runs against its real bundle.
import { describe, expect, it } from "vitest";
import { SERVER_VERSION_DEFINE, resolveServerVersion, serverVersion } from "./server-version.js";

describe("resolveServerVersion", () => {
  it("returns an injected version unchanged", () => {
    expect(resolveServerVersion("0.1.0")).toBe("0.1.0");
    expect(resolveServerVersion("1.2.3-rc.4")).toBe("1.2.3-rc.4");
  });

  it("throws, naming the define, when the build injected nothing", () => {
    expect(() => resolveServerVersion(undefined)).toThrow(SERVER_VERSION_DEFINE);
  });

  it("throws rather than announcing an empty version", () => {
    expect(() => resolveServerVersion("")).toThrow(SERVER_VERSION_DEFINE);
  });

  it("throws rather than announcing a non-string the define produced", () => {
    expect(() => resolveServerVersion(0)).toThrow(SERVER_VERSION_DEFINE);
    expect(() => resolveServerVersion({ version: "0.1.0" })).toThrow(SERVER_VERSION_DEFINE);
  });
});

describe("serverVersion", () => {
  // Vitest runs this source directly, with no esbuild `define` — which is
  // exactly the unsubstituted case. A server built without the define would
  // fail this same way at startup instead of announcing a made-up version.
  it("throws when the identifier was never substituted, as it is here", () => {
    expect(() => serverVersion()).toThrow(SERVER_VERSION_DEFINE);
  });
});
