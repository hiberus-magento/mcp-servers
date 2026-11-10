// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The OPTIONAL customer token. Adapter layer only — never inside `client/`.
//
// The storefront schema is public, so no token means an anonymous call, not an error
// (design D6). Only `MissingCredentialError` means "none": any other failure (a credential
// file with loose permissions, an unreadable file) propagates, so a misconfigured file is
// never silently downgraded to anonymous — the operator would think the customer tools
// were authenticated when they were not.
//
// Resolved on EVERY call and never cached, so a token added or replaced while the server is
// running takes effect on the very next call, with no restart.
import { MissingCredentialError, resolveCredentialValue } from "@hiberus-magento/mcp-core";

export const MAGENTO_GRAPHQL_DOMAIN = "magento-graphql";
export const TOKEN_ENV_VAR = "MAGENTO_GRAPHQL_TOKEN";

/** The stored customer token, or `undefined` when there is none (an anonymous call). */
export function resolveOptionalCustomerToken(configDir?: string): string | undefined {
  try {
    return configDir !== undefined
      ? resolveCredentialValue({ domain: MAGENTO_GRAPHQL_DOMAIN, envVar: TOKEN_ENV_VAR, configDir })
      : resolveCredentialValue({ domain: MAGENTO_GRAPHQL_DOMAIN, envVar: TOKEN_ENV_VAR });
  } catch (error) {
    if (error instanceof MissingCredentialError) {
      return undefined;
    }
    throw error;
  }
}
