// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The fourteen `eds_*` tools (eds-write-surface design.md). Lives in its own
// module, separate from `mcp.ts`, for exactly one reason: `mcp.ts` must call
// `server.connect(transport)` UNCONDITIONALLY at module top level, the same
// way every other template-generated server does — the domain-independent
// fd-1 conformance probe (`fd1-probe-harness.mjs`) works by `await
// import(serverPath)`-ing the built bundle directly and relying on that
// top-level connect having run (mcp-conformance spec, "Stdout Purity
// Assertion"; design.md, Decision 1). A module that connects unconditionally
// on import cannot also be imported safely by unit tests. This module has NO
// side effects — it only exports schemas and a factory function — so
// `mcp.test.ts` imports it directly, and `mcp.ts` is the only file that ever
// imports it AND triggers the connect.
//
// Twelve tools read. Every write goes through `eds_plan` (read-only: builds
// and stores the exact requests) and `eds_apply` (replays them for a one-time
// token) — see `plan-builder.ts` and `apply.ts`. No other tool may write;
// `mcp.test.ts` scans these modules to keep it that way.
import { defineTool, type RegisteredTool } from "@hiberus-magento/mcp-core";
import { z } from "zod";
import { createEdsClient, readBulkStatusResults, type EdsClient } from "../client/index.js";
import { createPlanStore } from "../confirm/plan-store.js";
import { createEdsTokenProvider } from "../credential-provider.js";
import { applyPlan } from "./apply.js";
import { buildPlan, type StoredPlan } from "./plan-builder.js";
import { edsApplyInput, edsPlanInput } from "./plan.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Rejects an omitted or empty `paths` array at the schema level (design.md, Decision 7). */
export const nonEmptyPaths = z.array(z.string().min(1)).min(1);

const siteInput = z.object({ site: z.string().min(1) }).strict();
const orgInput = z.object({}).strict();

const getStatusInput = z
  .object({
    site: z.string().min(1),
    path: z.string().min(1),
    ref: z.string().min(1).optional(),
  })
  .strict();

// Design.md, Decision 7: "paths capped at 100 in-schema" for the bulk-status
// query specifically (a backstop against an unbounded fan-out request).
const getStatusBulkInput = z
  .object({
    site: z.string().min(1),
    ref: z.string().min(1).optional(),
    paths: nonEmptyPaths.max(100),
    select: z.array(z.enum(["edit", "preview", "live"])).optional(),
  })
  .strict();

const getAuditLogInput = z
  .object({
    site: z.string().min(1),
    ref: z.string().min(1).optional(),
    since: z.string().min(1).optional(),
    nextToken: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

const getSnapshotsInput = z
  .object({
    site: z.string().min(1),
    id: z.string().min(1).optional(),
  })
  .strict();

const getJobStatusInput = z
  .object({
    site: z.string().min(1),
    ref: z.string().min(1).optional(),
    topic: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();

const listJobsInput = z
  .object({
    site: z.string().min(1),
    ref: z.string().min(1).optional(),
    topic: z.string().min(1),
  })
  .strict();

// No `owner`/`repo`: the repository is resolved from the site, as for
// `code.*` plans (eds-mcp spec, "Code Operations Resolve the Repository From
// the Site").
const getCodeStatusInput = z
  .object({
    site: z.string().min(1),
    path: z.string().min(1),
    ref: z.string().min(1).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Tool factory — a pure function of an already-constructed `EdsClient`, so
// it is unit-testable without spawning a process or resolving real
// credentials (`mcp.test.ts` passes a client built over `FetchDouble`).
// ---------------------------------------------------------------------------

/** Claude Code prompts on every call of a tool carrying this (D3). Other clients ignore it; nothing depends on it. */
export const REQUIRES_USER_INTERACTION_META: Readonly<Record<string, unknown>> = { "anthropic/requiresUserInteraction": true };

/** Only the surface `mcp.ts`'s registration loop and tests need — `RegisteredTool.handler` is intentionally excluded because it is typed per-tool and does not widen cleanly across the distinct input/output shapes. */
export type EdsMcpTool = Pick<RegisteredTool<z.ZodObject, unknown>, "name" | "description" | "inputSchema" | "annotations" | "invoke"> & {
  /** Passed to `registerTool` as `_meta`. */
  readonly meta?: Readonly<Record<string, unknown>>;
};

export interface EdsRuntime {
  readonly client: EdsClient;
  readonly org: string;
}

export interface EdsToolsConfig {
  /**
   * Resolved lazily, on the FIRST tool call, not at registration time —
   * `tools/list` must keep working even before `EDS_ORG` is set (e.g. under
   * the shared conformance suite, which spawns with a sanitized environment
   * containing only `PATH`). Only `tools/call` needs a real runtime.
   */
  readonly getRuntime: () => EdsRuntime;
  /** `EDS_PROTECTED_SITES`, already split — `mcp.ts` reads the environment, never this module. */
  readonly protectedSites?: readonly string[];
  /** The plan store's clock. */
  readonly now?: () => number;
}

/** `paths` is validated non-empty by `nonEmptyPaths` before this ever runs; the runtime check is a defensive backstop, not the gate itself. */
function asNonEmptyPaths(paths: readonly string[]): readonly [string, ...string[]] {
  if (paths.length === 0) {
    throw new Error("Internal error: nonEmptyPaths schema should have rejected an empty paths array before reaching this point.");
  }
  return paths as readonly [string, ...string[]];
}

function present<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]: V } | Record<string, never> {
  return value !== undefined ? ({ [key]: value } as { [P in K]: V }) : {};
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

export function createEdsTools(config: EdsToolsConfig): readonly EdsMcpTool[] {
  const { getRuntime } = config;
  const protectedSites = config.protectedSites ?? [];
  // One store per server process: tokens never outlive it (spec, "Tokens Are
  // Single-Use, Expiring and Unforgeable").
  const store = createPlanStore<StoredPlan>({ now: config.now ?? (() => Date.now()) });

  const edsGetStatus = defineTool({
    name: "eds_get_status",
    description:
      "Use this when you need one path's current status across edit/preview/live/code/index on a single site — the smallest, cheapest status call. Read-only.",
    inputSchema: getStatusInput,
    annotations: READ_ONLY,
    handler: async (args) => {
      const { client, org } = getRuntime();
      return client.operations.status.getStatus({ org, site: args.site, path: args.path, ...present("ref", args.ref) });
    },
  });

  const edsGetStatusBulk = defineTool({
    name: "eds_get_status_bulk",
    description:
      "Use this when you need status for several paths on a site at once instead of calling eds_get_status in a loop. Returns one entry per path that has content, plus missingPaths naming the requested paths that have none. Read-only (it queries, it does not mutate).",
    inputSchema: getStatusBulkInput,
    annotations: READ_ONLY,
    handler: async (args) => {
      const { client, org } = getRuntime();
      const submitted = await client.operations.status.getStatusBulk({
        org,
        site: args.site,
        paths: asNonEmptyPaths(args.paths),
        ...present("ref", args.ref),
        ...present("select", args.select),
      });
      // Observed live: the POST comes back with the job already completed
      // and its results inline, and the job is NOT retained afterwards —
      // polling it answers 404. So the poll only runs when the response
      // itself says the job has not finished (see `status.ts`'s header).
      if (submitted.results !== undefined) {
        return { job: submitted.job, results: submitted.results, missingPaths: submitted.missingPaths };
      }
      const finalJob = await client.jobs.waitForJob({ self: submitted.links.self });
      const job = { name: finalJob.name, topic: finalJob.topic, state: finalJob.state };
      const polled = readBulkStatusResults(finalJob, args.paths);
      return polled !== undefined
        ? { job, results: polled.results, missingPaths: polled.missingPaths, ...present("progress", finalJob.progress) }
        : { job, ...present("progress", finalJob.progress) };
    },
  });

  const edsGetSiteConfig = defineTool({
    name: "eds_get_site_config",
    description:
      "Use this when you need a site's full effective configuration — the site document alone does not resolve inheritance. Aggregates the site doc, CDN config, and effective config in one call. Read-only.",
    inputSchema: siteInput,
    annotations: READ_ONLY,
    handler: async (args) => {
      const { client, org } = getRuntime();
      return client.operations.siteConfig.getSiteConfig({ org, site: args.site });
    },
  });

  const edsGetAuditLog = defineTool({
    name: "eds_get_audit_log",
    description:
      "Use this to review recent changes to a site. Returns one page of audit-log entries plus a nextToken cursor — pass nextToken back in to continue; this tool never auto-drains the whole log. Read-only.",
    inputSchema: getAuditLogInput,
    annotations: READ_ONLY,
    handler: async (args) => {
      const { client, org } = getRuntime();
      return client.operations.auditLog.getAuditLog({
        org,
        site: args.site,
        ...present("ref", args.ref),
        ...present("since", args.since),
        ...present("nextToken", args.nextToken),
        ...present("limit", args.limit),
      });
    },
  });

  const edsGetSnapshots = defineTool({
    name: "eds_get_snapshots",
    description:
      "Use this to list a site's snapshots, or to inspect one by id. To change a snapshot, plan a snapshot.* operation with eds_plan. Read-only.",
    inputSchema: getSnapshotsInput,
    annotations: READ_ONLY,
    handler: async (args) => {
      const { client, org } = getRuntime();
      return args.id !== undefined
        ? client.operations.snapshots.showSnapshot({ org, site: args.site, id: args.id })
        : client.operations.snapshots.listSnapshots({ org, site: args.site });
    },
  });

  const edsGetJobStatus = defineTool({
    name: "eds_get_job_status",
    description:
      "Use this to check on a specific job by its site/ref/topic/name address, e.g. one returned by eds_apply when wait was not requested. Success is any 2xx. Read-only.",
    inputSchema: getJobStatusInput,
    annotations: READ_ONLY,
    handler: async (args) => {
      const { client, org } = getRuntime();
      const result = await client.jobs.getJobStatus({ org, site: args.site, topic: args.topic, name: args.name, ...present("ref", args.ref) });
      return { job: result.body.job, progress: result.body.job.progress, links: result.body.links };
    },
  });

  const edsListSites = defineTool({
    name: "eds_list_sites",
    description: "Use this to find which sites exist in the configured org before planning or reading one. Returns site names. Read-only. Not verified against a live service — built from the Admin API contract and covered by unit tests only.",
    inputSchema: orgInput,
    annotations: READ_ONLY,
    handler: async () => {
      const { client, org } = getRuntime();
      return client.operations.siteConfig.listSites({ org });
    },
  });

  const edsGetConfigVersions = defineTool({
    name: "eds_get_config_versions",
    description:
      "Use this to see a site's configuration history — the current version id and earlier versions — before planning a version.restore with eds_plan. Read-only. Not verified against a live service — built from the Admin API contract and covered by unit tests only.",
    inputSchema: siteInput,
    annotations: READ_ONLY,
    handler: async (args) => {
      const { client, org } = getRuntime();
      return client.operations.siteConfig.listConfigVersions({ org, site: args.site });
    },
  });

  const edsGetRobots = defineTool({
    name: "eds_get_robots",
    description: "Use this to read a site's robots.txt as text, e.g. before planning a robots.set with eds_plan. Read-only. Not verified against a live service — built from the Admin API contract and covered by unit tests only.",
    inputSchema: siteInput,
    annotations: READ_ONLY,
    handler: async (args) => {
      const { client, org } = getRuntime();
      return { site: args.site, content: await client.operations.robots.getRobots({ org, site: args.site }) };
    },
  });

  const edsGetCodeStatus = defineTool({
    name: "eds_get_code_status",
    description:
      "Use this to check one code file's status on the code bus. The repository is resolved from the site's own configuration — it cannot be supplied. Read-only. Not verified against a live service — built from the Admin API contract and covered by unit tests only.",
    inputSchema: getCodeStatusInput,
    annotations: READ_ONLY,
    handler: async (args) => {
      const { client, org } = getRuntime();
      const document = await client.operations.siteConfig.getSiteDocument({ org, site: args.site });
      const code = typeof document === "object" && document !== null ? (document as { code?: { owner?: unknown; repo?: unknown } }).code : undefined;
      if (typeof code?.owner !== "string" || typeof code.repo !== "string") {
        throw new Error(`The site document of ${args.site} names no repository (code.owner and code.repo).`);
      }
      const status = await client.operations.code.getCodeStatus({ owner: code.owner, repo: code.repo, path: args.path, ...present("ref", args.ref) });
      return { repository: `${code.owner}/${code.repo}`, status };
    },
  });

  const edsListJobs = defineTool({
    name: "eds_list_jobs",
    description: "Use this to list a site's jobs for one topic (e.g. live, preview, index), to find a running job to inspect or to plan a job.stop for. Read-only. Not verified against a live service — built from the Admin API contract and covered by unit tests only.",
    inputSchema: listJobsInput,
    annotations: READ_ONLY,
    handler: async (args) => {
      const { client, org } = getRuntime();
      return client.jobs.listJobs({ org, site: args.site, topic: args.topic, ...present("ref", args.ref) });
    },
  });

  const edsListApiKeys = defineTool({
    name: "eds_list_api_keys",
    description:
      "Use this to see which Admin API keys exist in the configured org (id, roles, description, expiry) — metadata only, never key material. Creating and deleting keys is CLI-only. Read-only.",
    inputSchema: orgInput,
    annotations: READ_ONLY,
    handler: async () => {
      const { client, org } = getRuntime();
      return client.auth.listApiKeys({ org });
    },
  });

  const edsPlan = defineTool({
    name: "eds_plan",
    description:
      "Use this for ANY change to an EDS site — configuration, site create/delete, version restore, robots.txt, preview, publish, index, cache, sitemap, code, jobs, snapshots. It changes nothing: it returns exactly what would happen, a confirmationMessage to show the user, and a one-time token. Show the message, wait for the user's explicit yes, then call eds_apply with the token. Read-only.",
    inputSchema: edsPlanInput,
    annotations: READ_ONLY,
    handler: async (args) => {
      const { client, org } = getRuntime();
      return buildPlan({ client, org, store, protectedSites }, args);
    },
  });

  const edsApply = defineTool({
    name: "eds_apply",
    description:
      "Use this only after the user has explicitly confirmed a plan from eds_plan in their latest message. Takes only the plan's token (and confirmSite when the plan requires the site name) and issues exactly the planned requests. A token works once and expires after ten minutes. Destructive and not idempotent. Not verified against a live service — only snapshot.add and snapshot.delete have run against a real Edge Delivery Services site; every other kind is built from the Admin API contract and covered by unit tests only.",
    inputSchema: edsApplyInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler: async (args) => {
      const { client } = getRuntime();
      return applyPlan({ client, store }, args);
    },
  });

  return [
    edsGetStatus,
    edsGetStatusBulk,
    edsGetSiteConfig,
    edsGetAuditLog,
    edsGetSnapshots,
    edsGetJobStatus,
    edsListSites,
    edsGetConfigVersions,
    edsGetRobots,
    edsGetCodeStatus,
    edsListJobs,
    edsListApiKeys,
    edsPlan,
    { ...edsApply, meta: REQUIRES_USER_INTERACTION_META },
  ];
}

const BASE_URL = "https://admin.hlx.page";

/**
 * Resolved LAZILY, on the first tool CALL, not at process startup —
 * `tools/list` must keep working even before `EDS_ORG` is set. Adapters
 * (unlike `client/`) are permitted to read `process.env` directly
 * (design.md: "mcp.ts — thin adapter"). A missing `EDS_ORG` therefore
 * surfaces as an immediate, actionable per-call error, never a startup
 * crash that would also take `tools/list` down with it (which the shared
 * conformance suite depends on, and which spawns with a sanitized
 * environment — see `mcp.conformance.test.ts`).
 */
export function createRuntimeResolver(): () => EdsRuntime {
  let runtime: EdsRuntime | undefined;
  return () => {
    if (runtime !== undefined) {
      return runtime;
    }
    const org = process.env.EDS_ORG;
    if (org === undefined || org.length === 0) {
      throw new Error(
        "hiberus-eds-mcp: the EDS_ORG environment variable is required to call any eds_* tool. Set EDS_ORG=<org> and restart the server.",
      );
    }
    const client = createEdsClient({
      fetch: globalThis.fetch,
      now: () => Date.now(),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      tokenProvider: createEdsTokenProvider(),
      baseUrl: BASE_URL,
      org,
    });
    runtime = { client, org };
    return runtime;
  };
}
