// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The Magento credential provider. Adapter layer only — never inside
// `client/`. A Magento integration access token (or an admin token) is a
// single static Bearer value, so this is the simple case: no minting, no
// expiry to check, nothing to refresh.
//
// It is written out instead of using mcp-core's `StaticTokenProvider`
// because that class rewrites EVERY resolution failure into a generic
// "missing credential" message, which would hide a credential file with
// loose permissions behind the wrong advice. Here the error from
// `resolveCredentialValue` propagates verbatim: a missing token names the
// command, the variable and the file; a `0644` file says so.
//
// Resolved on EVERY `getToken()` call and never cached, so a token added or
// replaced while the server is running takes effect on the very next call,
// with no restart.
import { credentialFilePath, resolveCredentialValue, type Credential, type Remedy, type TokenProvider } from "@hiberus-magento/mcp-core";

export const MAGENTO_REST_DOMAIN = "magento-rest";
export const TOKEN_ENV_VAR = "MAGENTO_REST_TOKEN";

export function resolveMagentoToken(configDir?: string): string {
  return configDir !== undefined
    ? resolveCredentialValue({ domain: MAGENTO_REST_DOMAIN, envVar: TOKEN_ENV_VAR, configDir })
    : resolveCredentialValue({ domain: MAGENTO_REST_DOMAIN, envVar: TOKEN_ENV_VAR });
}

export function createMagentoTokenProvider(configDir?: string): TokenProvider {
  const remedy: Remedy = {
    domain: MAGENTO_REST_DOMAIN,
    cliCommand: `hiberus-${MAGENTO_REST_DOMAIN} auth token set`,
    envVar: TOKEN_ENV_VAR,
    configPath: credentialFilePath(MAGENTO_REST_DOMAIN, configDir),
    reason: "no Magento integration or admin token was found",
  };
  return {
    domain: MAGENTO_REST_DOMAIN,
    async getToken(): Promise<Credential> {
      return { kind: "static", value: resolveMagentoToken(configDir) };
    },
    invalidate(): void {
      // A static token has nothing to invalidate; rotate it in Magento's admin.
    },
    describeRemedy(): Remedy {
      return remedy;
    },
  };
}
