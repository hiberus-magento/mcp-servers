// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Wires `client/auth.ts`'s `TokenProvider` need to `mcp-core`'s
// `StaticTokenProvider`, with EDS's own `Remedy` naming the out-of-band
// Adobe UI step (design.md, Decision 6). Constructed ONLY here, from
// `cli.ts`/`mcp.ts` — never inside `client/`, which never reads
// `EDS_TOKEN` or any credential file itself (design.md, Decision 2).
import { credentialFilePath, resolveCredentialValue, StaticTokenProvider, type Remedy, type TokenProvider } from "@hiberus-magento/mcp-core";

export const EDS_DOMAIN = "eds";
export const EDS_ENV_VAR = "EDS_TOKEN";

export function buildEdsRemedy(configDir?: string): Remedy {
  return {
    domain: EDS_DOMAIN,
    cliCommand: "hiberus-eds auth token set",
    envVar: EDS_ENV_VAR,
    configPath: credentialFilePath(EDS_DOMAIN, configDir),
    reason:
      "not found — the first admin-scoped key can only be created in Adobe's admin/Sidekick UI; see docs/eds-onboarding.md",
  };
}

export interface CreateEdsTokenProviderOptions {
  readonly configDir?: string;
}

export function createEdsTokenProvider(options?: CreateEdsTokenProviderOptions): TokenProvider {
  const configDir = options?.configDir;
  return new StaticTokenProvider({
    domain: EDS_DOMAIN,
    resolve: () => resolveEdsCredentialDirect(configDir),
    remedy: buildEdsRemedy(configDir),
  });
}

/**
 * Resolves the raw credential value directly (bypassing `StaticTokenProvider`,
 * design.md Decision 6's documented wart mitigation): a credential file at
 * loose permissions surfaces `LooseCredentialFilePermissionsError` verbatim,
 * instead of being caught and rewritten into a generic "missing credential"
 * by `StaticTokenProvider.getToken()`.
 */
export function resolveEdsCredentialDirect(configDir?: string): string {
  return configDir !== undefined
    ? resolveCredentialValue({ domain: EDS_DOMAIN, envVar: EDS_ENV_VAR, configDir })
    : resolveCredentialValue({ domain: EDS_DOMAIN, envVar: EDS_ENV_VAR });
}
