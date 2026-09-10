#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// eds — an MCP server for the eds domain, scaffolded from
// `templates/server/` (server-manifest spec, "Server Template Scaffold").
// Imports ONLY the stdio transport deep paths from the SDK — never the
// package barrel and never `server/index.js` directly (design.md, Decision
// 1) — so this package's bundle stays clean of express/hono/ajv/etc.
//
// The nine `eds_*` tools and the two hazard gates as TYPES (design.md,
// Decision 7):
//   1. `eds_reindex`'s full-site branch is unreachable without BOTH the
//      literal discriminant `scope: "full-site"` AND the literal `true` on
//      `confirmFullReindex` — a `z.discriminatedUnion` nested under a
//      `request` field, because `defineTool` requires a top-level
//      `ZodObject` and a discriminated union is not one.
//   2. Every bulk-write `paths` array is `nonEmptyPaths`
//      (`z.array(z.string().min(1)).min(1)`) — an omitted or empty array is
//      a schema rejection, never interpreted as "everything".
//
// Decision point (design.md Open Question 2 / tasks.md 7.9), recorded here
// rather than applied silently: the built `dist/mcp.js` was driven end to
// end with `mcp-testing`'s `JsonRpcClient` (see `mcp.conformance.test.ts`
// and this batch's apply-progress) — this environment has no third-party
// MCP client (e.g. Claude Desktop, Cursor) available to test the rendered
// tool-picker UI against. What WAS verified: `tools/list` returns
// well-formed JSON Schema (a valid nested `oneOf` under `request`, which is
// standard JSON Schema every spec-compliant consumer must parse), and
// `tools/call` round-trips both the `paths` and `full-site` branches
// end-to-end through the real built server. On that evidence the nested
// union is KEPT — not downgraded to a flat object + `superRefine`, which
// would lose the compile-time guarantee proven in `mcp.test-d.ts`. A wider
// claim (that a specific third-party agent UI renders it usably) was not
// tested and is not made here.
import { createStdioServer, defineTool, type RegisteredTool } from "@hiberus-magento/mcp-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { EdsClient, ReindexRequest } from "./client/index.js";
import { createEdsClient } from "./client/index.js";
import { createEdsTokenProvider } from "./credential-provider.js";

// ---------------------------------------------------------------------------
// Schemas (the wire-side hazard gates)
// ---------------------------------------------------------------------------

/** Rejects an omitted or empty `paths` array at the schema level (design.md, Decision 7). */
export const nonEmptyPaths = z.array(z.string().min(1)).min(1);

const reindexRequestSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("paths"), paths: nonEmptyPaths }).strict(),
  z.object({ scope: z.literal("full-site"), confirmFullReindex: z.literal(true) }).strict(),
]);

/** The full-site branch is unreachable without both `scope: "full-site"` AND `confirmFullReindex: true` (design.md, Decision 7). */
export const edsReindexInput = z
  .object({
    site: z.string().min(1),
    ref: z.string().min(1).optional(),
    request: reindexRequestSchema,
  })
  .strict();

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

const setLiveStateInput = z
  .object({
    site: z.string().min(1),
    ref: z.string().min(1).optional(),
    paths: nonEmptyPaths,
    state: z.enum(["published", "unpublished"]),
    wait: z.boolean().optional(),
  })
  .strict();

const getSiteConfigInput = z.object({ site: z.string().min(1) }).strict();

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

const manageSnapshotInput = z
  .object({
    site: z.string().min(1),
    id: z.string().min(1),
    verb: z.enum(["add", "remove", "publish", "review", "delete"]),
    paths: nonEmptyPaths.optional(),
    reviewAction: z.enum(["approve", "reject"]).optional(),
    message: z.string().optional(),
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

// ---------------------------------------------------------------------------
// Tool factory — a pure function of an already-constructed `EdsClient`, so
// it is unit-testable without spawning a process or resolving real
// credentials (`mcp.test.ts` passes a client built over `FetchDouble`).
// ---------------------------------------------------------------------------

/** Only the surface `mcp.ts`'s registration loop and tests need — `RegisteredTool.handler` is intentionally excluded because it is typed per-tool and does not widen cleanly across the nine distinct input/output shapes. */
export type EdsMcpTool = Pick<RegisteredTool<z.ZodObject, unknown>, "name" | "description" | "inputSchema" | "annotations" | "invoke">;

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
}

/** `paths` is validated non-empty by `nonEmptyPaths` before this ever runs; the runtime check is a defensive backstop, not the gate itself (design.md, Decision 7: a rest-tuple JSON Schema would be less portable, so the wire gate is `.min(1)`, and the tuple type is used only at this internal boundary). */
function asNonEmptyPaths(paths: readonly string[]): readonly [string, ...string[]] {
  if (paths.length === 0) {
    throw new Error("Internal error: nonEmptyPaths schema should have rejected an empty paths array before reaching this point.");
  }
  return paths as readonly [string, ...string[]];
}

function present<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]: V } | Record<string, never> {
  return value !== undefined ? ({ [key]: value } as { [P in K]: V }) : {};
}

function assertNeverVerb(verb: never): never {
  throw new Error(`eds_manage_snapshot: unhandled verb "${JSON.stringify(verb)}".`);
}

export function createEdsTools(config: EdsToolsConfig): readonly EdsMcpTool[] {
  const { getRuntime } = config;

  const edsGetStatus = defineTool({
    name: "eds_get_status",
    description:
      "Use this when you need one path's current status across edit/preview/live/code/index on a single site — the smallest, cheapest status call. Read-only.",
    inputSchema: getStatusInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args) => {
      const { client, org } = getRuntime();
      return client.operations.status.getStatus({ org, site: args.site, path: args.path, ...present("ref", args.ref) });
    },
  });

  const edsGetStatusBulk = defineTool({
    name: "eds_get_status_bulk",
    description:
      "Use this when you need status for several paths on a site at once instead of calling eds_get_status in a loop. Submits a bulk status query and waits for the job to finish. Read-only (it queries, it does not mutate).",
    inputSchema: getStatusBulkInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args) => {
      const { client, org } = getRuntime();
      const submitted = await client.operations.status.getStatusBulk({
        org,
        site: args.site,
        paths: asNonEmptyPaths(args.paths),
        ...present("ref", args.ref),
        ...present("select", args.select),
      });
      const finalJob = await client.jobs.waitForJob({ self: submitted.links.self });
      return { job: finalJob, progress: finalJob.progress };
    },
  });

  const edsSetLiveState = defineTool({
    name: "eds_set_live_state",
    description:
      "Use this to publish or unpublish one or more paths on a site. Set wait: true to block until the underlying job completes; otherwise the job continues in the background and eds_get_job_status can follow up on it. Destructive: it changes what is publicly live.",
    inputSchema: setLiveStateInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    handler: async (args) => {
      const { client, org } = getRuntime();
      const result = await client.operations.live.setLiveState({
        org,
        site: args.site,
        paths: asNonEmptyPaths(args.paths),
        state: args.state,
        ...present("ref", args.ref),
      });
      if (args.wait === true) {
        const finalJob = await client.jobs.waitForJob({ self: result.links.self });
        return { job: finalJob, progress: finalJob.progress, ignoredPaths: result.ignoredPaths };
      }
      return { job: result.job, ignoredPaths: result.ignoredPaths };
    },
  });

  const edsGetSiteConfig = defineTool({
    name: "eds_get_site_config",
    description:
      "Use this when you need a site's full effective configuration — the site document alone does not resolve inheritance. Aggregates the site doc, CDN config, and effective config in one call. Read-only.",
    inputSchema: getSiteConfigInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args) => {
      const { client, org } = getRuntime();
      return client.operations.siteConfig.getSiteConfig({ org, site: args.site });
    },
  });

  const edsReindex = defineTool({
    name: "eds_reindex",
    description:
      'Use this to re-run indexing for specific paths, or — only with explicit double confirmation ({ scope: "full-site", confirmFullReindex: true }) — the entire site. The full-site branch cannot be reached by scope alone; both fields are required. Not destructive to content, but resource-intensive at full-site scope.',
    inputSchema: edsReindexInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: async (args) => {
      const { client, org } = getRuntime();
      const request: ReindexRequest =
        args.request.scope === "full-site"
          ? { scope: "full-site", confirmFullReindex: true }
          : { scope: "paths", paths: asNonEmptyPaths(args.request.paths) };
      const submitted = await client.operations.indexOps.reindex({ org, site: args.site, request, ...present("ref", args.ref) });
      const finalJob = await client.jobs.waitForJob({ self: submitted.links.self });
      return { job: finalJob, progress: finalJob.progress };
    },
  });

  const edsGetAuditLog = defineTool({
    name: "eds_get_audit_log",
    description:
      "Use this to review recent changes to a site. Returns one page of audit-log entries plus a nextToken cursor — pass nextToken back in to continue; this tool never auto-drains the whole log. Read-only.",
    inputSchema: getAuditLogInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
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
      "Use this to list a site's snapshots, or to inspect one by id. The read half of the snapshot state machine — pair with eds_manage_snapshot for writes. Read-only.",
    inputSchema: getSnapshotsInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args) => {
      const { client, org } = getRuntime();
      return args.id !== undefined
        ? client.operations.snapshots.showSnapshot({ org, site: args.site, id: args.id })
        : client.operations.snapshots.listSnapshots({ org, site: args.site });
    },
  });

  const edsManageSnapshot = defineTool({
    name: "eds_manage_snapshot",
    description:
      "Use this to add paths to a snapshot, remove them, publish it, submit a review decision, or delete it. The write half of the snapshot state machine, split from eds_get_snapshots because annotations are static per tool. Destructive and NOT idempotent — repeating an add/remove changes the snapshot's contents each time.",
    inputSchema: manageSnapshotInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler: async (args) => {
      const { client, org } = getRuntime();
      switch (args.verb) {
        case "add":
          return client.operations.snapshots.addToSnapshot({ org, site: args.site, id: args.id, ...present("paths", args.paths) });
        case "remove":
          return client.operations.snapshots.removeFromSnapshot({ org, site: args.site, id: args.id, paths: args.paths ?? [] });
        case "publish":
          return client.operations.snapshots.publishSnapshot({ org, site: args.site, id: args.id });
        case "review":
          if (args.reviewAction === undefined) {
            throw new Error('eds_manage_snapshot: reviewAction is required when verb is "review".');
          }
          return client.operations.snapshots.reviewSnapshot({
            org,
            site: args.site,
            id: args.id,
            reviewAction: args.reviewAction,
            ...present("message", args.message),
          });
        case "delete":
          return client.operations.snapshots.deleteSnapshot({ org, site: args.site, id: args.id });
        default:
          return assertNeverVerb(args.verb);
      }
    },
  });

  const edsGetJobStatus = defineTool({
    name: "eds_get_job_status",
    description:
      "Use this to check on a specific job by its site/ref/topic/name address, e.g. one returned earlier by eds_set_live_state or eds_reindex when wait was not requested. Success is any 2xx. Read-only.",
    inputSchema: getJobStatusInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async (args) => {
      const { client, org } = getRuntime();
      const result = await client.jobs.getJobStatus({ org, site: args.site, topic: args.topic, name: args.name, ...present("ref", args.ref) });
      return { job: result.body.job, progress: result.body.job.progress, links: result.body.links };
    },
  });

  return [
    edsGetStatus,
    edsGetStatusBulk,
    edsSetLiveState,
    edsGetSiteConfig,
    edsReindex,
    edsGetAuditLog,
    edsGetSnapshots,
    edsManageSnapshot,
    edsGetJobStatus,
  ];
}

// ---------------------------------------------------------------------------
// Server wiring — only runs when this module is the process entrypoint, so
// `mcp.test.ts`/`mcp.test-d.ts` can import the schemas and `createEdsTools`
// above without resolving a real credential or connecting a transport.
// ---------------------------------------------------------------------------

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
function createRuntimeResolver(): () => EdsRuntime {
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

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

// The SDK constructs a real `AjvJsonSchemaValidator` at server-construction
// time unless an explicit `jsonSchemaValidator` is supplied (server/index.js:51).
// After the packaging gate aliases `ajv`/`ajv-formats` to throwing stubs
// (design.md, Decision 1, rung (b)), the default constructor would crash
// this server at startup. This server declares no `elicitation` capability
// and never calls `elicitInput`, so `getValidator()` is provably unreachable
// — the only caller is the elicitation result path at server/index.js:358.
const noElicitationValidator = {
  getValidator() {
    return () => {
      throw new McpError(ErrorCode.InvalidRequest, "elicitation is not supported by stdio servers");
    };
  },
};

const server = new McpServer(
  {
    name: "eds",
    version: "0.0.0",
  },
  {
    jsonSchemaValidator: noElicitationValidator,
  },
);

if (isDirectRun) {
  const getRuntime = createRuntimeResolver();

  for (const tool of createEdsTools({ getRuntime })) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema.shape, annotations: tool.annotations },
      async (args: unknown) => {
        const result = await tool.invoke(args, {});
        return { content: [...result.content], isError: result.isError };
      },
    );
  }

  // Install the stdout guard BEFORE connecting: it takes the real stdout
  // handle away from the whole process and hands it back only here, so the
  // transport is the one writer that can reach fd 1. Anything else that
  // writes to stdout is diverted to stderr instead of corrupting the
  // JSON-RPC stream.
  const { stdout } = createStdioServer();
  const transport = new StdioServerTransport(process.stdin, stdout);
  await server.connect(transport);
}
