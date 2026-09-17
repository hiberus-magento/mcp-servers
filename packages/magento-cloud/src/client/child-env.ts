// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Explicit, named-keys-only child-environment assembly (design.md,
// Decision 1's domain side; magento-cloud-client spec, "Explicit Child
// Environment Assembly"). NEVER a spread, NEVER a direct read of
// `process.env` — every value here is INJECTED by the caller, which is
// what keeps `client/` pure (magento-cloud-client spec, "Client Module
// Purity") and is exactly what makes `mcp-core`'s `CommandSpec.env`
// unable to smuggle in the parent's full environment.
export interface BuildChildEnvInput {
  /** Absent only for the one tool that deliberately tolerates no
   * credential (`magentocloud_auth_status`, design.md Decision 9) — in
   * that case `MAGENTO_CLOUD_CLI_TOKEN` is omitted entirely, never sent as
   * an empty string. */
  readonly token?: string;
  readonly home: string;
  readonly path: string;
}

export function buildChildEnv(input: BuildChildEnvInput): Readonly<Record<string, string>> {
  const env: Record<string, string> = {
    HOME: input.home,
    PATH: input.path,
  };
  if (input.token !== undefined) {
    env.MAGENTO_CLOUD_CLI_TOKEN = input.token;
  }
  return env;
}
