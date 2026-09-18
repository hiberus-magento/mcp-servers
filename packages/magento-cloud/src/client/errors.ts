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
      // Two exits, and the easier one first. This wrapper defers to the CLI's
      // own session when no token is configured, so an operator at a terminal
      // usually just needs to log in. Naming only the token path would send
      // them off for a credential they never needed. The token path stays,
      // because it is the one that works headless.
      `The Magento Cloud CLI is not authenticated. Run "magento-cloud login" to ` +
        `authenticate the CLI itself, or set ${envVar} to a valid API token — ` +
        `"hiberus-magento-cloud auth token set" configures it — and retry.`,
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

// design.md, Decision 4: the CLI's TSV output contract can drift (a
// reordered or renamed column) and CI has no real CLI to detect that drift
// against. This error is the runtime half of the compensating control —
// loud and named, pointing at the exact file a maintainer edits, rather
// than a silent `undefined` reaching an agent.
export class MagentoCloudOutputShapeError extends Error {
  constructor(input: { readonly subcommand: string; readonly missingHeader: string; readonly headersSeen: readonly string[] }) {
    super(
      `"${input.subcommand}" output is missing the required header "${input.missingHeader}" ` +
        `(headers seen: ${input.headersSeen.join(", ")}). The Magento Cloud CLI's output shape may have ` +
        `changed — update client/parsers/*.ts's REQUIRED_HEADERS for "${input.subcommand}" ` +
        `(see docs/magento-cloud-onboarding.md's fixture re-capture procedure).`,
    );
    this.name = "MagentoCloudOutputShapeError";
  }
}

// design.md, Decision 5: a byte-cap hit on db:sql is a failed call, never a
// silently short result set — `maxBuffer` overflow kills the child.
export class MagentoCloudOutputCapError extends Error {
  constructor(input: { readonly maxOutputBytes: number }) {
    super(
      `The query's output exceeded the ${input.maxOutputBytes}-byte cap and was terminated before it could ` +
        `complete. Narrow the column list or lower maxRows and retry.`,
    );
    this.name = "MagentoCloudOutputCapError";
  }
}
