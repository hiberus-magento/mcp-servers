// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Wires `client/`'s credential need to `mcp-core`'s `resolveCredentialValue`/
// `StaticTokenProvider`, naming the operator's own remedy (design.md,
// Decision 2). Mirrors `packages/eds/src/credential-provider.ts` (read-only
// precedent) exactly. Constructed ONLY here, from `cli.ts`/`mcp.ts` — never
// inside `client/`, which never reads `MAGENTO_CLOUD_CLI_TOKEN` or any
// credential file itself (magento-cloud-client spec, "Client Module
// Purity"). This module never imports `node:child_process`, `locateBinary`,
// or `runAllowlisted` — a missing credential fails before any process
// exists as a structural property of this file's own imports, not a race
// this module has to win at runtime.
import { credentialFilePath, resolveCredentialValue, StaticTokenProvider, type Remedy, type TokenProvider } from "@hiberus-magento/mcp-core";

export const MAGENTO_CLOUD_DOMAIN = "magento-cloud";
export const MAGENTO_CLOUD_ENV_VAR = "MAGENTO_CLOUD_CLI_TOKEN";

export function buildMagentoCloudRemedy(configDir?: string): Remedy {
  return {
    domain: MAGENTO_CLOUD_DOMAIN,
    cliCommand: "hiberus-magento-cloud auth token set",
    envVar: MAGENTO_CLOUD_ENV_VAR,
    configPath: credentialFilePath(MAGENTO_CLOUD_DOMAIN, configDir),
    reason: `not found — set ${MAGENTO_CLOUD_ENV_VAR} or run "hiberus-magento-cloud auth token set" to configure it`,
  };
}

export interface CreateMagentoCloudTokenProviderOptions {
  readonly configDir?: string;
}

export function createMagentoCloudTokenProvider(options?: CreateMagentoCloudTokenProviderOptions): TokenProvider {
  const configDir = options?.configDir;
  return new StaticTokenProvider({
    domain: MAGENTO_CLOUD_DOMAIN,
    resolve: () => resolveMagentoCloudCredentialDirect(configDir),
    remedy: buildMagentoCloudRemedy(configDir),
  });
}

/**
 * Resolves the raw credential value directly (bypassing
 * `StaticTokenProvider`, same documented wart mitigation as EDS's
 * `resolveEdsCredentialDirect`): a credential file at loose permissions
 * surfaces `LooseCredentialFilePermissionsError` verbatim, instead of
 * being caught and rewritten into a generic "missing credential" by
 * `StaticTokenProvider.getToken()`.
 */
export function resolveMagentoCloudCredentialDirect(configDir?: string): string {
  return configDir !== undefined
    ? resolveCredentialValue({ domain: MAGENTO_CLOUD_DOMAIN, envVar: MAGENTO_CLOUD_ENV_VAR, configDir })
    : resolveCredentialValue({ domain: MAGENTO_CLOUD_DOMAIN, envVar: MAGENTO_CLOUD_ENV_VAR });
}
