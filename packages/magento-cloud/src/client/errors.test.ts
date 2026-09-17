// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Each of the three CLI-failure error classes names the operator's exact
// remedy (design.md, Decision 2 table; magento-cloud-client spec,
// "CLI-Failure Classification Names an Actionable Remedy"; tasks.md 2.4-2.5).
import { describe, expect, it } from "vitest";
import {
  MagentoCloudNotAuthenticatedError,
  MagentoCloudNotInstalledError,
  MagentoCloudUnsupportedVersionError,
} from "./errors.js";

describe("MagentoCloudNotInstalledError", () => {
  it("names the binary and an install remedy", () => {
    const error = new MagentoCloudNotInstalledError("magento-cloud");

    expect(error.name).toBe("MagentoCloudNotInstalledError");
    expect(error.message).toContain("magento-cloud");
    expect(error.message.toLowerCase()).toContain("install");
  });
});

describe("MagentoCloudNotAuthenticatedError", () => {
  it("names MAGENTO_CLOUD_CLI_TOKEN as the remedy", () => {
    const error = new MagentoCloudNotAuthenticatedError("MAGENTO_CLOUD_CLI_TOKEN");

    expect(error.name).toBe("MagentoCloudNotAuthenticatedError");
    expect(error.message).toContain("MAGENTO_CLOUD_CLI_TOKEN");
  });
});

describe("MagentoCloudUnsupportedVersionError", () => {
  it("names the required minimum version, distinct from the other two errors", () => {
    const error = new MagentoCloudUnsupportedVersionError({ minimumVersion: "1.47.0", actualVersion: "0.9.0" });

    expect(error.name).toBe("MagentoCloudUnsupportedVersionError");
    expect(error.message).toContain("1.47.0");
    expect(error.message).toContain("0.9.0");
    expect(error.name).not.toBe(new MagentoCloudNotInstalledError("magento-cloud").name);
    expect(error.name).not.toBe(new MagentoCloudNotAuthenticatedError("MAGENTO_CLOUD_CLI_TOKEN").name);
  });
});
