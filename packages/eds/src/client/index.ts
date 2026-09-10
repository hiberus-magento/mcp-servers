// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The ONLY public surface of `client/` (design.md, Decision 2). Adapters
// (`cli.ts`, `mcp.ts`) may import nothing else from this directory — the
// `no-restricted-imports` boundary rule in `eslint.config.js` enforces this
// (proven by `packages/eds/eslint-fixtures/deep-client-import.ts`).
// Exports `createEdsClient`, `EdsClient`, `EdsClientDeps`, every error
// class, and every result/domain type a caller needs to use the client and
// interpret its results — nothing from `retry.ts`, `rate-limiter.ts`, or
// `paths.ts` (internal wiring, not part of the public contract).
import { authStatus, mintApiKey, type AuthStatusOptions, type MintApiKeyOptions } from "./auth.js";
import { fetchPage, type FetchPageOptions } from "./cursor.js";
import { createHttpClient, type EdsClientDeps, type HttpClient } from "./http.js";
import { fetchJobEnvelope, getJobStatus, waitForJob, type GetJobStatusOptions, type WaitForJobOptions } from "./jobs.js";
import { getAuditLog, type GetAuditLogOptions } from "./operations/audit-log.js";
import { reindex, type ReindexOptions } from "./operations/index-ops.js";
import { setLiveState, type SetLiveStateOptions } from "./operations/live.js";
import { getSiteConfig, putSiteConfig, type SiteConfigParams } from "./operations/site-config.js";
import {
  addToSnapshot,
  deleteSnapshot,
  listSnapshots,
  publishSnapshot,
  removeFromSnapshot,
  reviewSnapshot,
  showSnapshot,
  type AddToSnapshotOptions,
  type RemoveFromSnapshotOptions,
  type ReviewSnapshotOptions,
  type SnapshotRef,
  type SnapshotScope,
} from "./operations/snapshots.js";
import { getStatus, getStatusBulk, type GetStatusBulkOptions, type GetStatusOptions } from "./operations/status.js";

export {
  AdminRateLimitError,
  ContentSourceThrottledError,
  EdsError,
  GatewayError,
  JobTimeoutError,
  TransientNetworkError,
  UpstreamUnavailableError,
  type EdsErrorKind,
} from "./errors.js";
export type { EdsClientDeps, HttpClient, HttpMethod, SendOptions } from "./http.js";
export type { GetJobStatusOptions, JobBody, JobDescriptor, JobEnvelopeResult, JobLinks, JobPollDeps, JobProgress, JobState, WaitForJobOptions } from "./jobs.js";
export type { FetchPageOptions, Page } from "./cursor.js";
export { parseSiteList } from "./types.js";
export type { SiteListResult, SiteListWire } from "./types.js";
export type { AuditLogEntry, GetAuditLogOptions } from "./operations/audit-log.js";
export type { ReindexOptions, ReindexRequest, ReindexResult } from "./operations/index-ops.js";
export type { JobRef, SetLiveStateOptions, SetLiveStateResult } from "./operations/live.js";
export type { PutSiteConfigResult, SiteConfigParams, SiteConfigResult } from "./operations/site-config.js";
export type { AddToSnapshotOptions, RemoveFromSnapshotOptions, ReviewSnapshotOptions, SnapshotRef, SnapshotScope } from "./operations/snapshots.js";
export type { GetStatusBulkOptions, GetStatusBulkResult, GetStatusOptions, StatusPartitions } from "./operations/status.js";
export type { AuthProbeResult, AuthStatusOptions, AuthStatusResult, MintApiKeyOptions, MintedApiKey, ProbeVerdict } from "./auth.js";

export interface EdsClient {
  readonly http: HttpClient;
  readonly jobs: {
    readonly waitForJob: (options: WaitForJobOptions) => ReturnType<typeof waitForJob>;
    readonly fetchJobEnvelope: (self: string) => ReturnType<typeof fetchJobEnvelope>;
    readonly getJobStatus: (options: GetJobStatusOptions) => ReturnType<typeof getJobStatus>;
  };
  readonly cursor: {
    readonly fetchPage: <TEntry = unknown>(path: string, options?: FetchPageOptions) => ReturnType<typeof fetchPage<TEntry>>;
  };
  readonly auth: {
    readonly mintApiKey: (options: MintApiKeyOptions) => ReturnType<typeof mintApiKey>;
    readonly authStatus: (options: AuthStatusOptions) => ReturnType<typeof authStatus>;
  };
  readonly operations: {
    readonly siteConfig: {
      readonly getSiteConfig: (params: SiteConfigParams) => ReturnType<typeof getSiteConfig>;
      readonly putSiteConfig: (params: SiteConfigParams, config: unknown) => ReturnType<typeof putSiteConfig>;
    };
    readonly snapshots: {
      readonly listSnapshots: (scope: SnapshotScope) => ReturnType<typeof listSnapshots>;
      readonly showSnapshot: (ref: SnapshotRef) => ReturnType<typeof showSnapshot>;
      readonly addToSnapshot: (options: AddToSnapshotOptions) => ReturnType<typeof addToSnapshot>;
      readonly removeFromSnapshot: (options: RemoveFromSnapshotOptions) => ReturnType<typeof removeFromSnapshot>;
      readonly publishSnapshot: (ref: SnapshotRef) => ReturnType<typeof publishSnapshot>;
      readonly reviewSnapshot: (options: ReviewSnapshotOptions) => ReturnType<typeof reviewSnapshot>;
      readonly deleteSnapshot: (ref: SnapshotRef) => ReturnType<typeof deleteSnapshot>;
    };
    readonly live: {
      readonly setLiveState: (options: SetLiveStateOptions) => ReturnType<typeof setLiveState>;
    };
    readonly status: {
      readonly getStatus: (options: GetStatusOptions) => ReturnType<typeof getStatus>;
      readonly getStatusBulk: (options: GetStatusBulkOptions) => ReturnType<typeof getStatusBulk>;
    };
    readonly indexOps: {
      readonly reindex: (options: ReindexOptions) => ReturnType<typeof reindex>;
    };
    readonly auditLog: {
      readonly getAuditLog: (options: GetAuditLogOptions) => ReturnType<typeof getAuditLog>;
    };
  };
}

export function createEdsClient(deps: EdsClientDeps): EdsClient {
  const http = createHttpClient(deps);
  return {
    http,
    jobs: {
      waitForJob: (options) => waitForJob({ http, now: deps.now, sleep: deps.sleep }, options),
      fetchJobEnvelope: (self) => fetchJobEnvelope(http, self),
      getJobStatus: (options) => getJobStatus(http, options),
    },
    cursor: {
      fetchPage: (path, options) => fetchPage(http, path, options),
    },
    auth: {
      mintApiKey: (options) => mintApiKey(http, options),
      authStatus: (options) => authStatus(http, options),
    },
    operations: {
      siteConfig: {
        getSiteConfig: (params) => getSiteConfig(http, params),
        putSiteConfig: (params, config) => putSiteConfig(http, params, config),
      },
      snapshots: {
        listSnapshots: (scope) => listSnapshots(http, scope),
        showSnapshot: (ref) => showSnapshot(http, ref),
        addToSnapshot: (options) => addToSnapshot(http, options),
        removeFromSnapshot: (options) => removeFromSnapshot(http, options),
        publishSnapshot: (ref) => publishSnapshot(http, ref),
        reviewSnapshot: (options) => reviewSnapshot(http, options),
        deleteSnapshot: (ref) => deleteSnapshot(http, ref),
      },
      live: {
        setLiveState: (options) => setLiveState(http, options),
      },
      status: {
        getStatus: (options) => getStatus(http, options),
        getStatusBulk: (options) => getStatusBulk(http, options),
      },
      indexOps: {
        reindex: (options) => reindex(http, options),
      },
      auditLog: {
        getAuditLog: (options) => getAuditLog(http, options),
      },
    },
  };
}
