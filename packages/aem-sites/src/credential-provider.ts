// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// One bearer token per author environment (aem-sites-package design.md,
// D6), mirroring the field CLI's `eds aem auth`: the Developer Console
// "local development token", read from `AEM_TOKEN_<ENV>` or from the 0600
// credential file `aem-sites-<env>.json`, on EVERY call, so a token renewed
// with `hiberus-aem-sites auth token set --env <env>` is picked up without
// restarting the MCP client. No other authentication scheme exists here.
// Constructed only from `cli.ts`/`mcp.ts`/`tools/` — never inside `client/`.
import { credentialFilePath, resolveCredentialValue, StaticTokenProvider, type Remedy, type TokenProvider } from "@hiberus-magento/mcp-core";

export const AEM_DOMAIN_PREFIX = "aem-sites";
const ENV_NAME = /^[a-z0-9]+$/;

export class InvalidEnvironmentNameError extends Error {
  constructor(name: string) {
    super(`Invalid AEM environment name "${name}": use lowercase letters and digits only (it becomes AEM_TOKEN_<NAME>).`);
    this.name = "InvalidEnvironmentNameError";
  }
}

export function assertEnvName(env: string): string {
  if (!ENV_NAME.test(env)) {
    throw new InvalidEnvironmentNameError(env);
  }
  return env;
}

export function credentialDomain(env: string): string {
  return `${AEM_DOMAIN_PREFIX}-${assertEnvName(env)}`;
}

export function tokenEnvVar(env: string): string {
  return `AEM_TOKEN_${assertEnvName(env).toUpperCase()}`;
}

/**
 * Accepts what operators actually paste, exactly like the field CLI: the raw
 * token, the Developer Console JSON (`{"accessToken": "…"}`), or either one
 * prefixed with `Bearer `. Returns `undefined` when nothing usable is left.
 */
export function normalizeToken(raw: string): string | undefined {
  let value = raw.trim();
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { accessToken?: unknown };
      value = typeof parsed.accessToken === "string" ? parsed.accessToken.trim() : "";
    } catch {
      return undefined;
    }
  }
  if (/^bearer\s+/i.test(value)) {
    value = value.replace(/^bearer\s+/i, "").trim();
  }
  return value === "" || /\s/.test(value) ? undefined : value;
}

export function buildAemRemedy(env: string, configDir?: string): Remedy {
  const domain = credentialDomain(env);
  return {
    domain,
    cliCommand: `hiberus-aem-sites auth token set --env ${env}`,
    envVar: tokenEnvVar(env),
    configPath: credentialFilePath(domain, configDir),
    reason: "not found — copy the local development token from the Developer Console of this author; see docs/aem-sites-onboarding.md",
  };
}

/** Bypasses `StaticTokenProvider`'s catch so a loose-permission file is reported verbatim (same as `eds`). */
export function resolveAemTokenDirect(env: string, configDir?: string): string {
  const source = { domain: credentialDomain(env), envVar: tokenEnvVar(env), ...(configDir !== undefined ? { configDir } : {}) };
  const raw = resolveCredentialValue(source);
  const token = normalizeToken(raw);
  if (token === undefined) {
    throw new Error(`The stored token for "${env}" is not usable; store it again with: hiberus-aem-sites auth token set --env ${env}`);
  }
  return token;
}

export function createAemTokenProvider(env: string, options?: { readonly configDir?: string }): TokenProvider {
  return new StaticTokenProvider({
    domain: credentialDomain(env),
    resolve: () => resolveAemTokenDirect(env, options?.configDir),
    remedy: buildAemRemedy(env, options?.configDir),
  });
}
