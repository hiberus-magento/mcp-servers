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
import { authStatus, deleteApiKey, listApiKeys, mintApiKey, type AuthStatusOptions, type DeleteApiKeyOptions, type ListApiKeysOptions, type MintApiKeyOptions } from "./auth.js";
import { fetchPage, type FetchPageOptions } from "./cursor.js";
import { createHttpClient, type EdsClientDeps, type HttpClient } from "./http.js";
import { fetchJobEnvelope, getJobStatus, listJobs, stopJob, waitForJob, type GetJobStatusOptions, type ListJobsOptions, type WaitForJobOptions } from "./jobs.js";
import { getAuditLog, type GetAuditLogOptions } from "./operations/audit-log.js";
import { purgeCache } from "./operations/cache.js";
import { deleteCode, getCodeStatus, syncCode, type CodePathParams } from "./operations/code.js";
import { indexPath, reindex, unindexPath, type ReindexOptions } from "./operations/index-ops.js";
import { publishPath, setLiveState, unpublishPath, type BulkContentOptions, type SetLiveStateOptions } from "./operations/live.js";
import { previewBulk, previewPath, unpreviewPath } from "./operations/preview.js";
import { getRobots, setRobots, type SetRobotsOptions } from "./operations/robots.js";
import { rebuildSitemap } from "./operations/sitemap.js";
import type { ContentPathOptions } from "./operations/write-result.js";
import { sendPlannedRequest, type PlannedRequest } from "./planned-request.js";
import {
  createSite,
  deleteSite,
  getSiteConfig,
  getSiteDocument,
  siteExists,
  listConfigVersions,
  listSites,
  restoreConfigVersion,
  updateSiteConfig,
  type ListSitesOptions,
  type RestoreConfigVersionOptions,
  type SiteConfigParams,
} from "./operations/site-config.js";
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
  AdminApiAuthError,
  AdminApiEmptyBodyError,
  AdminApiMalformedBodyError,
  AdminApiStatusError,
  AdminRateLimitError,
  ContentSourceThrottledError,
  EdsError,
  GatewayError,
  JobTimeoutError,
  SiteExistenceError,
  TransientNetworkError,
  UpstreamUnavailableError,
  type AdminApiFailureContext,
  type EdsErrorKind,
} from "./errors.js";
export type { EdsClientDeps, HttpClient, HttpMethod, OptionalJsonBody, RequestContext, SendOptions } from "./http.js";
export type { GetJobStatusOptions, JobBody, JobDescriptor, JobEnvelopeResult, JobLinks, JobList, JobPollDeps, JobProgress, JobState, ListJobsOptions, WaitForJobOptions } from "./jobs.js";
export type { PlannedRequest } from "./planned-request.js";
export { writeRequests, type BulkAddress, type ContentAddress } from "./write-requests.js";
export type { CodePathParams } from "./operations/code.js";
export type { SetRobotsOptions } from "./operations/robots.js";
export type { FetchPageOptions, Page } from "./cursor.js";
export { parseSiteList } from "./types.js";
export type { SiteListEntryWire, SiteListResult, SiteListWire } from "./types.js";
export type { AuditLogEntry, GetAuditLogOptions } from "./operations/audit-log.js";
export type { ReindexOptions, ReindexRequest, ReindexResult } from "./operations/index-ops.js";
export type { BulkContentOptions, BulkJobResult, JobRef, SetLiveStateOptions, SetLiveStateResult } from "./operations/live.js";
export type {
  ConfigVersion,
  ConfigVersions,
  ListSitesOptions,
  RestoreConfigVersionOptions,
  SiteConfigParams,
  SiteConfigResult,
} from "./operations/site-config.js";
export type { ContentPathOptions, WriteResult } from "./operations/write-result.js";
export type {
  AddToSnapshotOptions,
  RemoveFromSnapshotOptions,
  ReviewSnapshotOptions,
  SnapshotRef,
  SnapshotScope,
  SnapshotWriteResult,
} from "./operations/snapshots.js";
export { readBulkStatusResults } from "./operations/status.js";
export type {
  BulkStatusResource,
  BulkStatusResults,
  GetStatusBulkOptions,
  GetStatusBulkResult,
  GetStatusOptions,
  StatusPartitions,
} from "./operations/status.js";
export type {
  ApiKeyRecord,
  AuthProbeResult,
  AuthStatusOptions,
  AuthStatusResult,
  DeleteApiKeyOptions,
  ListApiKeysOptions,
  MintApiKeyOptions,
  MintedApiKey,
  ProbeVerdict,
} from "./auth.js";

export interface EdsClient {
  readonly http: HttpClient;
  /** `eds_apply`'s replay entry point: the client's only generic write (see `planned-request.ts`). */
  readonly sendPlannedRequest: (request: PlannedRequest) => ReturnType<typeof sendPlannedRequest>;
  readonly jobs: {
    readonly waitForJob: (options: WaitForJobOptions) => ReturnType<typeof waitForJob>;
    readonly fetchJobEnvelope: (self: string) => ReturnType<typeof fetchJobEnvelope>;
    readonly getJobStatus: (options: GetJobStatusOptions) => ReturnType<typeof getJobStatus>;
    readonly listJobs: (options: ListJobsOptions) => ReturnType<typeof listJobs>;
    readonly stopJob: (options: GetJobStatusOptions) => ReturnType<typeof stopJob>;
  };
  readonly cursor: {
    readonly fetchPage: <TEntry = unknown>(path: string, options?: FetchPageOptions) => ReturnType<typeof fetchPage<TEntry>>;
  };
  readonly auth: {
    readonly mintApiKey: (options: MintApiKeyOptions) => ReturnType<typeof mintApiKey>;
    readonly listApiKeys: (options: ListApiKeysOptions) => ReturnType<typeof listApiKeys>;
    readonly deleteApiKey: (options: DeleteApiKeyOptions) => ReturnType<typeof deleteApiKey>;
    readonly authStatus: (options: AuthStatusOptions) => ReturnType<typeof authStatus>;
  };
  readonly operations: {
    readonly siteConfig: {
      readonly getSiteConfig: (params: SiteConfigParams) => ReturnType<typeof getSiteConfig>;
      readonly getSiteDocument: (params: SiteConfigParams) => ReturnType<typeof getSiteDocument>;
      readonly siteExists: (params: SiteConfigParams) => ReturnType<typeof siteExists>;
      readonly createSite: (params: SiteConfigParams, config: unknown) => ReturnType<typeof createSite>;
      readonly updateSiteConfig: (params: SiteConfigParams, config: unknown) => ReturnType<typeof updateSiteConfig>;
      readonly deleteSite: (params: SiteConfigParams) => ReturnType<typeof deleteSite>;
      readonly listSites: (options: ListSitesOptions) => ReturnType<typeof listSites>;
      readonly listConfigVersions: (params: SiteConfigParams) => ReturnType<typeof listConfigVersions>;
      readonly restoreConfigVersion: (options: RestoreConfigVersionOptions) => ReturnType<typeof restoreConfigVersion>;
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
    readonly robots: {
      readonly getRobots: (params: SiteConfigParams) => ReturnType<typeof getRobots>;
      readonly setRobots: (options: SetRobotsOptions) => ReturnType<typeof setRobots>;
    };
    readonly preview: {
      readonly previewPath: (options: ContentPathOptions) => ReturnType<typeof previewPath>;
      readonly unpreviewPath: (options: ContentPathOptions) => ReturnType<typeof unpreviewPath>;
      readonly previewBulk: (options: BulkContentOptions) => ReturnType<typeof previewBulk>;
    };
    readonly live: {
      readonly setLiveState: (options: SetLiveStateOptions) => ReturnType<typeof setLiveState>;
      readonly publishPath: (options: ContentPathOptions) => ReturnType<typeof publishPath>;
      readonly unpublishPath: (options: ContentPathOptions) => ReturnType<typeof unpublishPath>;
    };
    readonly status: {
      readonly getStatus: (options: GetStatusOptions) => ReturnType<typeof getStatus>;
      readonly getStatusBulk: (options: GetStatusBulkOptions) => ReturnType<typeof getStatusBulk>;
    };
    readonly indexOps: {
      readonly reindex: (options: ReindexOptions) => ReturnType<typeof reindex>;
      readonly indexPath: (options: ContentPathOptions) => ReturnType<typeof indexPath>;
      readonly unindexPath: (options: ContentPathOptions) => ReturnType<typeof unindexPath>;
    };
    readonly cache: {
      readonly purgeCache: (options: ContentPathOptions) => ReturnType<typeof purgeCache>;
    };
    readonly sitemap: {
      readonly rebuildSitemap: (options: ContentPathOptions) => ReturnType<typeof rebuildSitemap>;
    };
    readonly code: {
      readonly getCodeStatus: (params: CodePathParams) => ReturnType<typeof getCodeStatus>;
      readonly syncCode: (params: CodePathParams) => ReturnType<typeof syncCode>;
      readonly deleteCode: (params: CodePathParams) => ReturnType<typeof deleteCode>;
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
    sendPlannedRequest: (request) => sendPlannedRequest(http, request),
    jobs: {
      waitForJob: (options) => waitForJob({ http, now: deps.now, sleep: deps.sleep }, options),
      fetchJobEnvelope: (self) => fetchJobEnvelope(http, self),
      getJobStatus: (options) => getJobStatus(http, options),
      listJobs: (options) => listJobs(http, options),
      stopJob: (options) => stopJob(http, options),
    },
    cursor: {
      fetchPage: (path, options) => fetchPage(http, path, options),
    },
    auth: {
      mintApiKey: (options) => mintApiKey(http, options),
      listApiKeys: (options) => listApiKeys(http, options),
      deleteApiKey: (options) => deleteApiKey(http, options),
      authStatus: (options) => authStatus(http, options),
    },
    operations: {
      siteConfig: {
        getSiteConfig: (params) => getSiteConfig(http, params),
        getSiteDocument: (params) => getSiteDocument(http, params),
        siteExists: (params) => siteExists(http, params),
        createSite: (params, config) => createSite(http, params, config),
        updateSiteConfig: (params, config) => updateSiteConfig(http, params, config),
        deleteSite: (params) => deleteSite(http, params),
        listSites: (options) => listSites(http, options),
        listConfigVersions: (params) => listConfigVersions(http, params),
        restoreConfigVersion: (options) => restoreConfigVersion(http, options),
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
      robots: {
        getRobots: (params) => getRobots(http, params),
        setRobots: (options) => setRobots(http, options),
      },
      preview: {
        previewPath: (options) => previewPath(http, options),
        unpreviewPath: (options) => unpreviewPath(http, options),
        previewBulk: (options) => previewBulk(http, options),
      },
      live: {
        setLiveState: (options) => setLiveState(http, options),
        publishPath: (options) => publishPath(http, options),
        unpublishPath: (options) => unpublishPath(http, options),
      },
      status: {
        getStatus: (options) => getStatus(http, options),
        getStatusBulk: (options) => getStatusBulk(http, options),
      },
      indexOps: {
        reindex: (options) => reindex(http, options),
        indexPath: (options) => indexPath(http, options),
        unindexPath: (options) => unindexPath(http, options),
      },
      cache: {
        purgeCache: (options) => purgeCache(http, options),
      },
      sitemap: {
        rebuildSitemap: (options) => rebuildSitemap(http, options),
      },
      code: {
        getCodeStatus: (params) => getCodeStatus(http, params),
        syncCode: (params) => syncCode(http, params),
        deleteCode: (params) => deleteCode(http, params),
      },
      auditLog: {
        getAuditLog: (options) => getAuditLog(http, options),
      },
    },
  };
}
