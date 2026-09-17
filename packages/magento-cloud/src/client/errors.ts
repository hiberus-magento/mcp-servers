// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The three-way CLI-failure classification (design.md, Decision 2;
// magento-cloud-client spec, "CLI-Failure Classification Names an
// Actionable Remedy"). Each error names the operator's exact remedy rather
// than collapsing into a generic execution failure — `not-installed` is
// detected pre-spawn by `locate-binary.ts`, closing `mcp-core`'s
// `run-allowlisted.ts:43` `ENOENT` trap (`typeof error.code === "number" ?
// error.code : 1`, where Node sets `error.code` to the STRING `"ENOENT"`
// for a missing binary) before it can ever collapse a missing CLI into an
// indistinguishable generic exit 1.
export class MagentoCloudNotInstalledError extends Error {
  constructor(binaryName: string) {
    super(
      `"${binaryName}" was not found on the configured PATH. Install the Magento Cloud CLI ` +
        `(see docs/magento-cloud-onboarding.md) and ensure "${binaryName}" is on PATH before retrying.`,
    );
    this.name = "MagentoCloudNotInstalledError";
  }
}

export class MagentoCloudNotAuthenticatedError extends Error {
  constructor(envVar: string) {
    super(
      `The Magento Cloud CLI is not authenticated. Set ${envVar} to a valid API token — run ` +
        `"hiberus-magento-cloud auth token set" to configure it — and retry.`,
    );
    this.name = "MagentoCloudNotAuthenticatedError";
  }
}

export class MagentoCloudUnsupportedVersionError extends Error {
  constructor(input: { readonly minimumVersion: string; readonly actualVersion: string }) {
    super(
      `The installed Magento Cloud CLI reports version ${input.actualVersion}, below the ` +
        `minimum supported ${input.minimumVersion}. Upgrade the CLI and retry.`,
    );
    this.name = "MagentoCloudUnsupportedVersionError";
  }
}
