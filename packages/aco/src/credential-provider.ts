// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The admin credential provider (design.md, Decision 2; the 2026-09-17
// re-ordering note at the top of tasks.md's Phase 3). Adapter layer only,
// never inside `client/`. Two real implementations of `TokenProvider`, kept
// apart by type: `MintedTokenProvider` (mcp-core, unchanged) fits the mint
// path with no modification; `PastedBearerProvider` (this file) is the
// small domain class `mcp-core` has no provider for at all — nothing there
// can express a human-pasted value with an expiry to check.
//
// PRIMARY PATH: minting. A credential from a Developer Console project that
// has the "Adobe Commerce Optimizer Admin" API added, exchanged via
// `client_credentials`, keeps all four Tier-B tools alive indefinitely
// through automatic re-mint — verified against a real tenant by decoding the
// minted token's JWT payload and confirming `scope` actually contains
// `commerce.aco.admin`. The pasted Bearer remains an explicit override for
// an operator without Developer Console access; a stored/env Bearer still
// wins over client credentials when both are present (see
// `selectAdminProvider`) — an operator only pastes one deliberately.
//
// The verification subtlety that must not be skipped anywhere a credential
// is validated: IMS can return a 200 with a well-formed `access_token` that
// carries FEWER scopes than requested, with no error at all. Getting an
// `access_token` back proves nothing about the admin scope on its own — the
// decoded `scope` claim must be checked. `mintAdminToken` below does this
// immediately after every mint, before the value is ever cached or handed
// to a caller.
import {
  credentialFilePath,
  resolveCredentialValue,
  CredentialExpiredError,
  MintedTokenProvider,
  MissingCredentialError,
  type Credential,
  type Remedy,
  type TokenProvider,
} from "@hiberus-magento/mcp-core";
import { AdminScopeError } from "./client/index.js";

export const ACO_DOMAIN = "aco";
export const ACO_TOKEN_ENV_VAR = "ACO_TOKEN";
export const ACO_CLIENT_ID_ENV_VAR = "ACO_CLIENT_ID";
export const ACO_CLIENT_SECRET_ENV_VAR = "ACO_CLIENT_SECRET";

const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
/**
 * Requested exactly as verified against a real tenant post-correction
 * (tasks.md, Phase 3's 2026-09-17 note): a credential from a project missing
 * the "Adobe Commerce Optimizer Admin" API fails `client_credentials` with
 * `unauthorized_client` even for bare `openid,AdobeID` — this is NOT a
 * broken grant, it is a project configuration gap. With that API added, the
 * decoded response carries `scope: "commerce.aco.admin,openid,AdobeID"`.
 */
const REQUESTED_ADMIN_SCOPE = "commerce.aco.admin,openid,AdobeID";
const REQUIRED_ADMIN_SCOPE = "commerce.aco.admin";
const DEFAULT_MINT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// selectAdminProvider — a pure, unit-testable precedence function
// (design.md, Decision 2's "Composition"). The CLI's `auth status` calls
// this directly to print its verdict and the reason; the composite provider
// below (`createAdminTokenProvider`) calls it internally on every
// `getToken()`, never once at construction, so a credential added or
// removed while the process is running takes effect on the very next call.
// ---------------------------------------------------------------------------
export interface SelectAdminProviderInput {
  readonly storedOrEnvBearer: boolean;
  readonly clientCredentials: boolean;
}

export interface SelectAdminProviderResult {
  readonly selection: "pasted-bearer" | "minted" | "none";
  readonly reason: string;
}

/**
 * Precedence: a stored/env Bearer wins over client credentials, unconditionally.
 * An operator only pastes a Bearer deliberately — letting a mint attempt
 * override it would re-break the working path on every call and spend a
 * round-trip on a path the operator has already moved off of.
 */
export function selectAdminProvider(input: SelectAdminProviderInput): SelectAdminProviderResult {
  if (input.storedOrEnvBearer) {
    return {
      selection: "pasted-bearer",
      reason: input.clientCredentials
        ? `A stored/env Bearer is present (${ACO_TOKEN_ENV_VAR} or the credential file) and takes precedence over configured client credentials.`
        : `A stored/env Bearer is present (${ACO_TOKEN_ENV_VAR} or the credential file).`,
    };
  }
  if (input.clientCredentials) {
    return {
      selection: "minted",
      reason: `No stored/env Bearer is present; minting via ${ACO_CLIENT_ID_ENV_VAR}/${ACO_CLIENT_SECRET_ENV_VAR}.`,
    };
  }
  return {
    selection: "none",
    reason: `Neither a stored/env Bearer nor ${ACO_CLIENT_ID_ENV_VAR}/${ACO_CLIENT_SECRET_ENV_VAR} are configured.`,
  };
}

// ---------------------------------------------------------------------------
// Shared JWT payload decoding — used by BOTH the pasted-Bearer expiry check
// and the minted-token scope verification below. No signature check is ever
// performed by either caller; this is purely for reading claims that were
// already trusted by the party that produced the token (a human pasting
// their own Studio session, or Adobe's own IMS response).
// ---------------------------------------------------------------------------
function decodeClaimsUnverified(token: string): Record<string, unknown> {
  const segments = token.split(".");
  const payloadSegment = segments[1];
  if (payloadSegment === undefined) {
    return {};
  }
  try {
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Adobe's classic IMS JWT convention encodes both as milliseconds, sometimes as strings. */
function claimAsMs(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function parseGrantedScopes(accessToken: string): readonly string[] {
  const claims = decodeClaimsUnverified(accessToken);
  const scope = claims["scope"];
  if (typeof scope !== "string") {
    return [];
  }
  return scope
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// ---------------------------------------------------------------------------
// Credential 1a — the pasted-Bearer override (mcp-core has no provider that
// can express this: `StaticTokenProvider` cannot express expiry, and
// `MintedTokenProvider` mints — there is nothing to mint from a value a
// human pasted). Resolves `resolve()` fresh on EVERY `getToken()` call —
// never cached — so a replaced value takes effect on the very next call
// with no restart (design.md, Decision 0's self-heal property).
// ---------------------------------------------------------------------------
export interface PastedBearerProviderOptions {
  readonly domain: string;
  readonly now: () => number;
  readonly remedy: Remedy;
  /** Re-invoked on every `getToken()` call — MUST NOT be memoized by the caller. */
  readonly resolve: () => string;
}

export class PastedBearerProvider implements TokenProvider {
  readonly domain: string;
  readonly #now: () => number;
  readonly #remedy: Remedy;
  readonly #resolve: () => string;

  constructor(options: PastedBearerProviderOptions) {
    this.domain = options.domain;
    this.#now = options.now;
    this.#remedy = options.remedy;
    this.#resolve = options.resolve;
  }

  async getToken(): Promise<Credential> {
    const value = this.#resolve();
    const claims = decodeClaimsUnverified(value);
    const createdAt = claimAsMs(claims["created_at"]);
    const expiresIn = claimAsMs(claims["expires_in"]);
    if (createdAt !== undefined && expiresIn !== undefined) {
      const expiresAt = createdAt + expiresIn;
      if (expiresAt <= this.#now()) {
        // Thrown BEFORE any request — no transport call happens on this path.
        throw new CredentialExpiredError(this.#remedy);
      }
      return { kind: "minted", value, expiresAt };
    }
    // No decodable created_at/expires_in pair: nothing to check expiry
    // against. The value is used as-is — an undecodable token is a
    // signature/format concern for the ACO API to reject, not this
    // provider's to pre-judge.
    return { kind: "minted", value, expiresAt: Number.POSITIVE_INFINITY };
  }

  invalidate(): void {
    // A pasted Bearer has nothing to invalidate — the operator must paste a
    // fresh one via `hiberus-aco auth token set`.
  }

  describeRemedy(): Remedy {
    return this.#remedy;
  }
}

// ---------------------------------------------------------------------------
// Credential resolution helpers (env-over-file, mirrors eds's
// `resolveEdsCredentialDirect`): bypasses `StaticTokenProvider` so a
// `LooseCredentialFilePermissionsError` surfaces verbatim instead of being
// rewritten into a generic missing-credential message.
// ---------------------------------------------------------------------------
export function resolveAcoCredentialDirect(configDir?: string): string {
  return configDir !== undefined
    ? resolveCredentialValue({ domain: ACO_DOMAIN, envVar: ACO_TOKEN_ENV_VAR, configDir })
    : resolveCredentialValue({ domain: ACO_DOMAIN, envVar: ACO_TOKEN_ENV_VAR });
}

function hasStoredOrEnvBearer(configDir?: string): boolean {
  try {
    resolveAcoCredentialDirect(configDir);
    return true;
  } catch (error) {
    if (error instanceof MissingCredentialError) {
      return false;
    }
    // A loose-permission file (or anything else) must surface verbatim, not
    // be silently treated as "no Bearer configured".
    throw error;
  }
}

function hasClientCredentials(): boolean {
  const id = process.env[ACO_CLIENT_ID_ENV_VAR];
  const secret = process.env[ACO_CLIENT_SECRET_ENV_VAR];
  return id !== undefined && id !== "" && secret !== undefined && secret !== "";
}

function buildBearerExpiredRemedy(configDir?: string): Remedy {
  return {
    domain: ACO_DOMAIN,
    cliCommand: `hiberus-${ACO_DOMAIN} auth token set`,
    envVar: ACO_TOKEN_ENV_VAR,
    configPath: credentialFilePath(ACO_DOMAIN, configDir),
    reason: "the pasted Bearer's decoded expires_in has elapsed — paste a fresh Studio session Bearer, or configure client credentials to mint instead",
  };
}

function buildMintTimeoutRemedy(configDir?: string): Remedy {
  return {
    domain: ACO_DOMAIN,
    cliCommand: "hiberus-aco auth mint",
    envVar: ACO_CLIENT_ID_ENV_VAR,
    configPath: credentialFilePath(ACO_DOMAIN, configDir),
    reason: "the IMS mint request timed out",
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required to mint an ACO admin credential.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Credential 1b — the mint path (primary — see this file's header). Fits
// `MintedTokenProvider` (mcp-core, unchanged) without modification: single-
// flight coalescing means two concurrent expired-token calls trigger exactly
// one IMS mint. `MintedTokenProvider.getToken()` reads `Date.now()` directly
// (a documented mcp-core wart, design.md Decision 2) rather than an injected
// clock — this provider's OWN `now` is only used for the response's
// `expiresAt` computation below, not for the cache-freshness check itself.
// ---------------------------------------------------------------------------
interface ImsTokenResponseBody {
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly error?: string;
  readonly error_description?: string;
}

export interface MintAdminTokenDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly configDir?: string;
}

/**
 * POSTs `ims/token/v3` with `grant_type=client_credentials`, then — the
 * mandatory verification step — decodes the response's `access_token` JWT
 * payload and confirms its `scope` claim actually contains
 * `commerce.aco.admin`. IMS can return 200 with a syntactically valid
 * `access_token` carrying fewer scopes than requested, with no error at all;
 * an `access_token` alone proves nothing.
 */
export async function mintAdminToken(deps: MintAdminTokenDeps): Promise<{ readonly value: string; readonly expiresAt: number }> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: deps.clientId,
    client_secret: deps.clientSecret,
    scope: REQUESTED_ADMIN_SCOPE,
  });
  const response = await deps.fetch(IMS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const parsed = (await response.json()) as ImsTokenResponseBody;

  if (typeof parsed.access_token !== "string" || parsed.access_token.length === 0) {
    const reason = parsed.error_description ?? parsed.error ?? "IMS did not return an access_token.";
    throw new MissingCredentialError({
      domain: ACO_DOMAIN,
      cliCommand: "hiberus-aco auth mint",
      envVar: ACO_CLIENT_ID_ENV_VAR,
      configPath: credentialFilePath(ACO_DOMAIN, deps.configDir),
      reason: `IMS mint failed: ${reason} — if this is "unauthorized_client", add the "Adobe Commerce Optimizer Admin" API to the Developer Console project, or paste a Studio session Bearer with hiberus-aco auth token set instead.`,
    });
  }

  const grantedScopes = parseGrantedScopes(parsed.access_token);
  if (!grantedScopes.includes(REQUIRED_ADMIN_SCOPE)) {
    // The gap this exists to catch: a 200 with a well-formed access_token
    // that simply lacks the scope this package needs.
    throw new MissingCredentialError({
      domain: ACO_DOMAIN,
      cliCommand: "hiberus-aco auth mint",
      envVar: ACO_CLIENT_ID_ENV_VAR,
      configPath: credentialFilePath(ACO_DOMAIN, deps.configDir),
      // Both exits, deliberately — an operator without Developer Console
      // access cannot take the first one, and telling them only to retry the
      // mint sends them in a circle.
      reason:
        `IMS granted a token but without the required scope "${REQUIRED_ADMIN_SCOPE}" ` +
        `(granted: ${grantedScopes.length > 0 ? grantedScopes.join(",") : "none"}). ` +
        `Add the "Adobe Commerce Optimizer Admin" API to the Developer Console project for this credential, then re-attempt hiberus-aco auth mint — ` +
        `or, without console access, paste a Studio session Bearer with hiberus-aco auth token set instead.`,
    });
  }

  const expiresInMs = typeof parsed.expires_in === "number" ? parsed.expires_in * 1000 : 0;
  return { value: parsed.access_token, expiresAt: deps.now() + expiresInMs };
}

export interface CreateMintedAdminTokenProviderOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly configDir?: string;
  readonly mintTimeoutMs?: number;
}

export function createMintedAdminTokenProvider(options: CreateMintedAdminTokenProviderOptions): MintedTokenProvider {
  return new MintedTokenProvider({
    domain: ACO_DOMAIN,
    mintTimeoutMs: options.mintTimeoutMs ?? DEFAULT_MINT_TIMEOUT_MS,
    remedy: buildMintTimeoutRemedy(options.configDir),
    mint: () =>
      mintAdminToken({
        fetch: options.fetch,
        now: options.now,
        clientId: requiredEnv(ACO_CLIENT_ID_ENV_VAR),
        clientSecret: requiredEnv(ACO_CLIENT_SECRET_ENV_VAR),
        ...(options.configDir !== undefined ? { configDir: options.configDir } : {}),
      }),
  });
}

// ---------------------------------------------------------------------------
// relayCredentialFailure — the ONLY place an AcoError becomes an mcp-core
// credential error (design.md, Decision 0). `defineTool.invoke` already
// catches `MissingCredentialError`/`CredentialExpiredError` and returns an
// actionable `isError: true` result; everything else propagates raw. A LIVE
// `AdminScopeError` (a 200-with-errors on an admin route, discovered mid-
// session, not at pre-flight) would therefore reach an agent as an
// uncaught exception — the exact opaque failure the contract forbids. This
// function is the wrapper that prevents it. Called from the four Tier-B
// tool handlers in `tools/aco-tools.ts` (tasks.md 5.10).
// ---------------------------------------------------------------------------
export function relayCredentialFailure(error: unknown, configDir?: string): never {
  if (error instanceof AdminScopeError) {
    const remedy: Remedy = {
      domain: ACO_DOMAIN,
      cliCommand: "hiberus-aco auth mint",
      envVar: ACO_TOKEN_ENV_VAR,
      configPath: credentialFilePath(ACO_DOMAIN, configDir),
      reason: `${error.message} — two exits: re-attempt hiberus-aco auth mint, or paste a fresh Studio session Bearer with hiberus-aco auth token set.`,
    };
    const relayed = new CredentialExpiredError(remedy);
    relayed.cause = error;
    throw relayed;
  }
  throw error;
}

// ---------------------------------------------------------------------------
// The composite `TokenProvider` actually wired into `createAcoClient`'s
// deps (design.md, Decision 2's "Composition — both paths primary, no
// auto-chaining"). Re-evaluates `selectAdminProvider` on EVERY `getToken()`
// call — never memoized — so the credential resolves per call, matching
// `PastedBearerProvider`'s own re-read discipline. The `MintedTokenProvider`
// instance is constructed exactly once and kept, preserving its single-
// flight coalescing and cached-token behaviour across calls.
// ---------------------------------------------------------------------------
export interface CreateAdminTokenProviderOptions {
  readonly now: () => number;
  readonly fetch: typeof globalThis.fetch;
  readonly configDir?: string;
  readonly mintTimeoutMs?: number;
}

export function createAdminTokenProvider(options: CreateAdminTokenProviderOptions): TokenProvider {
  const { now, configDir } = options;
  const pastedProvider = new PastedBearerProvider({
    domain: ACO_DOMAIN,
    now,
    remedy: buildBearerExpiredRemedy(configDir),
    resolve: () => resolveAcoCredentialDirect(configDir),
  });
  const mintedProvider = createMintedAdminTokenProvider(options);

  return {
    domain: ACO_DOMAIN,
    async getToken(): Promise<Credential> {
      const decision = selectAdminProvider({
        storedOrEnvBearer: hasStoredOrEnvBearer(configDir),
        clientCredentials: hasClientCredentials(),
      });
      if (decision.selection === "pasted-bearer") {
        return pastedProvider.getToken();
      }
      if (decision.selection === "minted") {
        return mintedProvider.getToken();
      }
      // "none" — let resolveAcoCredentialDirect produce the canonical,
      // well-formed MissingCredentialError naming `hiberus-aco auth token set`.
      resolveAcoCredentialDirect(configDir);
      /* istanbul ignore next -- resolveAcoCredentialDirect always throws when selection is "none" */
      throw new Error("unreachable: resolveAcoCredentialDirect should have thrown MissingCredentialError");
    },
    invalidate(generation: number): void {
      mintedProvider.invalidate(generation);
    },
    describeRemedy(): Remedy {
      return buildBearerExpiredRemedy(configDir);
    },
  };
}
