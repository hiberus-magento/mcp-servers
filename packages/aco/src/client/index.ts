// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The ONLY public surface of `client/` (design.md, Decision 2). Adapters
// (`cli.ts`, `mcp.ts`) may import nothing else from this directory — the
// `no-restricted-imports` boundary rule in `eslint.config.js` enforces this
// (proven by `eslint-fixtures/deep-client-import.ts`).
//
// The factory wires, by track: the admin and merchandising transports
// (Phase 1, each carrying its own `ADMIN_PACE`/`MERCH_PACE` rate limiter);
// and a retry loop over `retry.ts`'s pure policy, reading each operation's
// `idempotent` flag (default `true` for queries; the six admin mutations
// declare `false` explicitly) so a misclassified throttle can never replay
// a write. `retry.ts`/`rate-limiter.ts` themselves stay unexported —
// internal wiring, not part of the public contract.
import type { TokenProvider } from "@hiberus-magento/mcp-core";
import {
  AcoError,
  AcoOperationError,
  AcoSchemaMismatchError,
  AcoThrottledError,
  AcoTransportError,
  AdminScopeError,
  CatalogViewAccessError,
  type RetryableAcoError,
} from "./errors.js";
import { createAdminTransport, createMerchandisingTransport, type AdminTransport, type MerchandisingTransport } from "./http.js";
import type { CatalogViewAccessTokenSupplier } from "./headers.js";
import { listChannels } from "./operations/channels.js";
import { getFacetValues, type FacetValuesOptions } from "./operations/facets.js";
import { createChannel, createPolicy, deleteChannel, deletePolicy, updateChannel, updatePolicy } from "./operations/mutations.js";
import { listPriceBooks, type ListPriceBooksOptions } from "./operations/price-books.js";
import { listPolicies } from "./operations/policies.js";
import { listScopes } from "./operations/scopes.js";
import { searchCatalog, type SearchCatalogOptions } from "./operations/search.js";
import { decideRetry } from "./retry.js";
import type { FacetValuesResult, ListChannelsResult, ListPoliciesResult, ListPriceBooksResult, ListScopesResult, SearchCatalogResult } from "./types.js";

export { AcoError, AcoOperationError, AcoSchemaMismatchError, AcoThrottledError, AcoTransportError, AdminScopeError, CatalogViewAccessError };
export type { AcoErrorKind, RetryableAcoError } from "./errors.js";
export type { ChannelResult, FacetValuesResult, ListChannelsResult, ListPoliciesResult, ListPriceBooksResult, ListScopesResult, PolicyResult, PriceBookResult, SearchCatalogResult } from "./types.js";
export type { CreateChannelInput, CreatePolicyInput, DeleteChannelInput, DeletePolicyInput, UpdateChannelInput, UpdatePolicyInput } from "./operations/mutations.js";
export type { FacetValuesOptions } from "./operations/facets.js";
export type { ListPriceBooksOptions } from "./operations/price-books.js";
export type { SearchCatalogOptions } from "./operations/search.js";
export type { MerchandisingRequestContext } from "./http.js";

export interface AcoClientDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly adminBaseUrl: string;
  readonly merchandisingBaseUrl: string;
  /** Tier B only (design.md, Decision 0). Absent means every admin call fails with a credential error at `getToken()`. */
  readonly tokenProvider: TokenProvider;
  readonly apiKey?: string;
  readonly imsOrgId?: string;
  /** Absent by default — an unprotected Merchandising view sends no credential-shaped header at all. */
  readonly catalogViewAccessToken?: CatalogViewAccessTokenSupplier;
  /** Injectable for deterministic full-jitter retry backoff in tests. Defaults to `Math.random`. */
  readonly random?: () => number;
}

function isRetryableAcoError(error: unknown): error is RetryableAcoError {
  return error instanceof AcoThrottledError || error instanceof AcoTransportError;
}

/**
 * Runs `attemptFn` under `retry.ts`'s pure policy: a retryable failure
 * (`AcoThrottledError | AcoTransportError`) is retried, gated on
 * `idempotent`; every other `AcoError` (a live scope failure, a schema
 * mismatch, a certain operation failure) is never retried — it is not in
 * the retryable union at all, so it always rethrows on the first attempt.
 */
async function runWithRetry<T>(deps: AcoClientDeps, idempotent: boolean, attemptFn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await attemptFn();
    } catch (error) {
      if (!isRetryableAcoError(error)) {
        throw error;
      }
      const decision = decideRetry({ error, idempotent }, attempt, deps.random);
      if (!decision.retry) {
        throw error;
      }
      await deps.sleep(decision.delayMs);
    }
  }
}

function wrapAdminTransport(transport: AdminTransport, deps: AcoClientDeps): AdminTransport {
  return {
    execute: (operation) => runWithRetry(deps, operation.idempotent ?? true, () => transport.execute(operation)),
  };
}

function wrapMerchandisingTransport(transport: MerchandisingTransport, deps: AcoClientDeps): MerchandisingTransport {
  return {
    execute: (operation, context) => runWithRetry(deps, operation.idempotent ?? true, () => transport.execute(operation, context)),
  };
}

export interface AcoClient {
  readonly scopes: {
    readonly listScopes: () => Promise<ListScopesResult>;
  };
  readonly channels: {
    readonly listChannels: () => Promise<ListChannelsResult>;
    readonly createChannel: (input: Parameters<typeof createChannel>[1]) => ReturnType<typeof createChannel>;
    readonly updateChannel: (input: Parameters<typeof updateChannel>[1]) => ReturnType<typeof updateChannel>;
    readonly deleteChannel: (input: Parameters<typeof deleteChannel>[1]) => ReturnType<typeof deleteChannel>;
  };
  readonly policies: {
    readonly listPolicies: () => Promise<ListPoliciesResult>;
    readonly createPolicy: (input: Parameters<typeof createPolicy>[1]) => ReturnType<typeof createPolicy>;
    readonly updatePolicy: (input: Parameters<typeof updatePolicy>[1]) => ReturnType<typeof updatePolicy>;
    readonly deletePolicy: (input: Parameters<typeof deletePolicy>[1]) => ReturnType<typeof deletePolicy>;
  };
  readonly priceBooks: {
    readonly listPriceBooks: (options: ListPriceBooksOptions) => Promise<ListPriceBooksResult>;
  };
  readonly search: {
    readonly searchCatalog: (options: SearchCatalogOptions) => Promise<SearchCatalogResult>;
  };
  readonly facets: {
    readonly getFacetValues: (options: FacetValuesOptions) => Promise<FacetValuesResult>;
  };
}

export function createAcoClient(deps: AcoClientDeps): AcoClient {
  const admin = wrapAdminTransport(
    createAdminTransport({
      fetch: deps.fetch,
      now: deps.now,
      sleep: deps.sleep,
      baseUrl: deps.adminBaseUrl,
      tokenProvider: deps.tokenProvider,
      ...(deps.apiKey !== undefined ? { apiKey: deps.apiKey } : {}),
      ...(deps.imsOrgId !== undefined ? { imsOrgId: deps.imsOrgId } : {}),
    }),
    deps,
  );
  const merchandising = wrapMerchandisingTransport(
    createMerchandisingTransport({
      fetch: deps.fetch,
      now: deps.now,
      sleep: deps.sleep,
      baseUrl: deps.merchandisingBaseUrl,
      ...(deps.catalogViewAccessToken !== undefined ? { catalogViewAccessToken: deps.catalogViewAccessToken } : {}),
    }),
    deps,
  );

  return {
    scopes: {
      listScopes: () => listScopes(admin),
    },
    channels: {
      listChannels: () => listChannels(admin),
      createChannel: (input) => createChannel(admin, input),
      updateChannel: (input) => updateChannel(admin, input),
      deleteChannel: (input) => deleteChannel(admin, input),
    },
    policies: {
      listPolicies: () => listPolicies(admin),
      createPolicy: (input) => createPolicy(admin, input),
      updatePolicy: (input) => updatePolicy(admin, input),
      deletePolicy: (input) => deletePolicy(admin, input),
    },
    priceBooks: {
      listPriceBooks: (options) => listPriceBooks(admin, options),
    },
    search: {
      searchCatalog: (options) => searchCatalog(merchandising, options),
    },
    facets: {
      getFacetValues: (options) => getFacetValues(merchandising, options),
    },
  };
}
