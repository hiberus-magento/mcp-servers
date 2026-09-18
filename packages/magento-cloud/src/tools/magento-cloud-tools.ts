// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The eight `magentocloud_*` tools (magento-cloud-mcp spec). Lives in its
// own module, separate from `mcp.ts`, for the same reason as `eds`/`aco`:
// `mcp.ts` must call `server.connect(transport)` UNCONDITIONALLY at module
// top level, so a module that connects on import cannot also be imported
// safely by unit tests. This module has no side effects at import time — it
// only exports schemas and a factory function.
//
// Every inbound schema is `.strict()` — the MCP wire gate is untrusted-input
// territory (deliberately the INVERSE of `client/tsv.ts`'s tolerant parsing
// of the CLI's own output, which is a boundary this package owns and can
// choose to be forgiving about).
//
// `magentocloud_query_database`'s `request` field is a DISCRIMINATED UNION
// (`z.discriminatedUnion("kind", ...)`) — never a boolean `includeSize` flag
// alongside `query`, and never a free-form `mode` string. This is the
// dangerous branch: `guardQuery()` (wired inside `commands.ts`'s `db:sql`
// spec) is the only thing standing between an agent's SQL text and a
// production database, and a boolean/string-mode shape is exactly the kind
// of schema an agent could satisfy accidentally on the "safe" branch while
// believing it requested a bounded read.
import { z } from "zod";
import { defineTool, type RegisteredTool, type ToolCallResult, type ToolContext } from "@hiberus-magento/mcp-core";
import {
  MagentoCloudCommandFailedError,
  MagentoCloudNotInstalledError,
  MagentoCloudUnsupportedVersionError,
  buildChildEnv,
  createMagentoCloudAllowlist,
  ensureBinaryResolved,
  executeReadOnlyCommand,
  parseActivityGet,
  parseActivityList,
  parseAppConfig,
  parseAuthInfo,
  parseDbSize,
  parseDbSqlRows,
  parseEnvironmentInfo,
  parseEnvironmentList,
  parseProjectInfo,
  parseProjectList,
  parseRouteList,
  parseServiceEndpoints,
  parseServiceList,
  parseVariableList,
  ROW_CAP,
} from "../client/index.js";
import { resolveMagentoCloudCredentialDirect } from "../credential-provider.js";

const MAGENTO_CLOUD_BINARY_NAME = "magento-cloud";

// ---------------------------------------------------------------------------
// Runtime resolver — resolved LAZILY, on the first tool CALL, not at process
// startup (mirrors `eds`/`aco`'s `createRuntimeResolver`), so `tools/list`
// keeps working even before the binary is installed. `process.env` is read
// HERE, in the adapter layer, never inside `client/` (magento-cloud-client
// spec, "Client Module Purity").
// ---------------------------------------------------------------------------
export interface MagentoCloudRuntime {
  readonly bin: string;
  readonly home: string;
  readonly path: string;
}

export function createMagentoCloudRuntimeResolver(): () => MagentoCloudRuntime {
  let runtime: MagentoCloudRuntime | undefined;
  return () => {
    if (runtime !== undefined) {
      return runtime;
    }
    const path = process.env["PATH"] ?? "";
    const bin = ensureBinaryResolved({ binaryName: MAGENTO_CLOUD_BINARY_NAME, pathEntries: path.split(":") });
    runtime = { bin, home: process.env["HOME"] ?? "", path };
    return runtime;
  };
}

export interface MagentoCloudToolsConfig {
  readonly getRuntime: () => MagentoCloudRuntime;
  /** Injected clock, never `Date.now()` read directly — mirrors `classify.ts`'s own discipline. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Every tool call that surfaces a `MagentoCloudCommandFailedError`,
 * `MagentoCloudNotInstalledError`, or `MagentoCloudUnsupportedVersionError`
 * becomes a distinguishable `isError: true` result naming its own remedy
 * (magento-cloud-mcp spec, "CLI-Failure Classification Surfaces as Distinct
 * Actionable Tool Errors"). `MissingCredentialError`/`CredentialExpiredError`
 * are already caught by `defineTool.invoke` itself (mcp-core, read-only) —
 * this wrapper handles exactly the three classifications `invoke()` does
 * NOT catch, at the adapter boundary, mirroring `aco`'s own
 * `relayCredentialFailure` pattern.
 */
export async function invokeMagentoCloudTool(
  tool: Pick<RegisteredTool<z.ZodObject, unknown>, "invoke">,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  try {
    return await tool.invoke(rawArgs, ctx);
  } catch (error) {
    if (error instanceof MagentoCloudNotInstalledError || error instanceof MagentoCloudUnsupportedVersionError || error instanceof MagentoCloudCommandFailedError) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Schemas — all `.strict()`.
// ---------------------------------------------------------------------------

const projectScoped = { projectId: z.string().min(1) };
const environmentScoped = { projectId: z.string().min(1), environmentId: z.string().min(1) };

export const magentocloudAuthStatusInput = z.object({}).strict();
export const magentocloudListProjectsInput = z.object({}).strict();
export const magentocloudDescribeProjectInput = z.object({ ...projectScoped }).strict();
export const magentocloudListEnvironmentsInput = z.object({ ...projectScoped }).strict();
export const magentocloudDescribeEnvironmentInput = z.object({ ...environmentScoped }).strict();

const environmentConfigInclude = z.enum(["variables", "routes", "services", "serviceEndpoints", "appConfig"]);
export const magentocloudGetEnvironmentConfigInput = z
  .object({ ...environmentScoped, include: z.array(environmentConfigInclude).min(1).optional() })
  .strict();

export const magentocloudGetActivitiesInput = z
  .object({ projectId: z.string().min(1), environmentId: z.string().min(1).optional(), activityId: z.string().min(1).optional() })
  .strict();

const dbSizeRequest = z.object({ kind: z.literal("size") }).strict();
const dbSelectRequest = z
  .object({ kind: z.literal("select"), query: z.string().min(1), maxRows: z.number().int().positive().max(ROW_CAP).optional() })
  .strict();

export const magentocloudQueryDatabaseInput = z
  .object({ ...environmentScoped, request: z.discriminatedUnion("kind", [dbSizeRequest, dbSelectRequest]) })
  .strict();

// ---------------------------------------------------------------------------
// Tool factory.
// ---------------------------------------------------------------------------

/** Only the surface `mcp.ts`'s registration loop and tests need. */
export type MagentoCloudMcpTool = Pick<RegisteredTool<z.ZodObject, unknown>, "name" | "description" | "inputSchema" | "annotations" | "invoke">;

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

export function createMagentoCloudTools(config: MagentoCloudToolsConfig): readonly MagentoCloudMcpTool[] {
  const { getRuntime } = config;
  const now = config.now ?? (() => Date.now());

  function resolveSpec(bin: string, subcommand: readonly string[]) {
    const spec = createMagentoCloudAllowlist(bin).resolve(bin, subcommand);
    if (spec === undefined) {
      throw new Error(`internal error: "${subcommand.join(" ")}" is not registered on the allowlist.`);
    }
    return spec;
  }

/**
 * The child gets HOME, so the spawned CLI can find the session that
 * `magento-cloud login` leaves in `~/.magento-cloud/`. A configured token is
 * therefore an OPTION, not a precondition: refusing to spawn without one told
 * a user who had already logged in to paste a credential they did not need.
 *
 * When no token is configured we still run the command. If the CLI has a
 * session it works; if it does not, the CLI reports that itself and
 * `classify` turns it into `not-authenticated`, whose remedy names both
 * exits — which is a better message than the one we declined to go and get.
 */
function childEnvWithOptionalToken(home: string, path: string): Readonly<Record<string, string>> {
  let token: string | undefined;
  try {
    token = resolveMagentoCloudCredentialDirect();
  } catch {
    token = undefined;
  }
  return buildChildEnv({ ...(token !== undefined ? { token } : {}), home, path });
}

  const authStatus = defineTool({
    name: "magentocloud_auth_status",
    description:
      "Use this to check whether the Magento Cloud CLI is authenticated before calling any other magentocloud_* tool. Never requires a credential itself — it reports whether one is configured and valid. Read-only.",
    inputSchema: magentocloudAuthStatusInput,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async () => {
      const { bin, home, path } = getRuntime();
      const spec = resolveSpec(bin, ["auth:info", "--no-auto-login"]);
      const specWithEnv = { ...spec, env: childEnvWithOptionalToken(home, path) };
      try {
        const stdout = await executeReadOnlyCommand({ spec: specWithEnv, rawArgs: {}, now });
        return { authenticated: true, account: parseAuthInfo(stdout) };
      } catch (error) {
        if (error instanceof MagentoCloudCommandFailedError && error.kind === "not-authenticated") {
          return { authenticated: false };
        }
        throw error;
      }
    },
  });

  const listProjects = defineTool({
    name: "magentocloud_list_projects",
    description: "Use this to list every project accessible to the authenticated account — the starting point for finding a projectId. Read-only.",
    inputSchema: magentocloudListProjectsInput,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async () => {
      const { bin, home, path } = getRuntime();
      const spec = resolveSpec(bin, ["project:list"]);
      const specWithEnv = { ...spec, env: childEnvWithOptionalToken(home, path) };
      const stdout = await executeReadOnlyCommand({ spec: specWithEnv, rawArgs: {}, now });
      return { projects: parseProjectList(stdout) };
    },
  });

  const describeProject = defineTool({
    name: "magentocloud_describe_project",
    description: "Use this to get one project's title and region by projectId, before listing its environments. Read-only.",
    inputSchema: magentocloudDescribeProjectInput,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args) => {
      const { bin, home, path } = getRuntime();
      const spec = resolveSpec(bin, ["project:info"]);
      const specWithEnv = { ...spec, env: childEnvWithOptionalToken(home, path) };
      const stdout = await executeReadOnlyCommand({ spec: specWithEnv, rawArgs: { projectId: args.projectId }, now });
      return parseProjectInfo(stdout);
    },
  });

  const listEnvironments = defineTool({
    name: "magentocloud_list_environments",
    description: "Use this to list a project's environments (id, status, type, title) — most other tools need an environmentId as input. Read-only.",
    inputSchema: magentocloudListEnvironmentsInput,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args) => {
      const { bin, home, path } = getRuntime();
      const spec = resolveSpec(bin, ["environment:list"]);
      const specWithEnv = { ...spec, env: childEnvWithOptionalToken(home, path) };
      const stdout = await executeReadOnlyCommand({ spec: specWithEnv, rawArgs: { projectId: args.projectId }, now });
      return { environments: parseEnvironmentList(stdout) };
    },
  });

  const describeEnvironment = defineTool({
    name: "magentocloud_describe_environment",
    description: "Use this to get one environment's status and type by projectId/environmentId. Read-only.",
    inputSchema: magentocloudDescribeEnvironmentInput,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args) => {
      const { bin, home, path } = getRuntime();
      const spec = resolveSpec(bin, ["environment:info"]);
      const specWithEnv = { ...spec, env: childEnvWithOptionalToken(home, path) };
      const stdout = await executeReadOnlyCommand({
        spec: specWithEnv,
        rawArgs: { projectId: args.projectId, environmentId: args.environmentId },
        now,
      });
      return parseEnvironmentInfo(stdout);
    },
  });

  const getEnvironmentConfig = defineTool({
    name: "magentocloud_get_environment_config",
    description:
      'Use this to fetch environment configuration facets on demand: "variables", "routes", "services", "serviceEndpoints" (host/port/scheme/service only — credentials are never returned, even though the underlying CLI output carries them), and "appConfig". Read-only.',
    inputSchema: magentocloudGetEnvironmentConfigInput,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args) => {
      const { bin, home, path } = getRuntime();
      const env = childEnvWithOptionalToken(home, path);
      const rawArgs = { projectId: args.projectId, environmentId: args.environmentId };
      const include = new Set(args.include ?? []);
      const result: Record<string, unknown> = {};

      if (include.has("variables")) {
        const spec = { ...resolveSpec(bin, ["variable:list"]), env };
        result["variables"] = parseVariableList(await executeReadOnlyCommand({ spec, rawArgs, now }));
      }
      if (include.has("routes")) {
        const spec = { ...resolveSpec(bin, ["route:list"]), env };
        result["routes"] = parseRouteList(await executeReadOnlyCommand({ spec, rawArgs, now }));
      }
      if (include.has("services")) {
        const spec = { ...resolveSpec(bin, ["service:list"]), env };
        result["services"] = parseServiceList(await executeReadOnlyCommand({ spec, rawArgs, now }));
      }
      if (include.has("serviceEndpoints")) {
        // Credential stripping happens INSIDE parseServiceEndpoints
        // (design.md, Decision 7): construction of ServiceEndpoint is the
        // stripping — there is no `{ ...raw }` anywhere on this path.
        const spec = { ...resolveSpec(bin, ["environment:relationships"]), env };
        result["serviceEndpoints"] = parseServiceEndpoints(await executeReadOnlyCommand({ spec, rawArgs, now }));
      }
      if (include.has("appConfig")) {
        const spec = { ...resolveSpec(bin, ["app:config-get"]), env };
        result["appConfig"] = parseAppConfig(await executeReadOnlyCommand({ spec, rawArgs, now }));
      }
      return result;
    },
  });

  const getActivities = defineTool({
    name: "magentocloud_get_activities",
    description:
      "Use this to list recent deployment/activity events for a project (optionally scoped to one environment), or to fetch one activity by activityId. Read-only.",
    inputSchema: magentocloudGetActivitiesInput,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args) => {
      const { bin, home, path } = getRuntime();
      const env = childEnvWithOptionalToken(home, path);
      if (args.activityId !== undefined) {
        const spec = { ...resolveSpec(bin, ["activity:get"]), env };
        const stdout = await executeReadOnlyCommand({
          spec,
          rawArgs: { projectId: args.projectId, activityId: args.activityId },
          now,
        });
        return parseActivityGet(stdout);
      }
      const spec = { ...resolveSpec(bin, ["activity:list"]), env };
      const rawArgs: Record<string, unknown> = { projectId: args.projectId };
      if (args.environmentId !== undefined) {
        rawArgs["environmentId"] = args.environmentId;
      }
      const stdout = await executeReadOnlyCommand({ spec, rawArgs, now });
      return { activities: parseActivityList(stdout) };
    },
  });

  const queryDatabase = defineTool({
    name: "magentocloud_query_database",
    description:
      'Use this for a bounded, read-only diagnostic query against an environment\'s database — either { kind: "size" } for usage stats, or { kind: "select", query, maxRows? } for a single guarded SELECT/SHOW/DESCRIBE/EXPLAIN statement. Every write verb, bare "*" projection, and file-exfiltration form is rejected before any process spawns; a SELECT with no LIMIT gets one injected automatically. rowsReturned === rowCap means more rows exist. Read-only.',
    inputSchema: magentocloudQueryDatabaseInput,
    annotations: READ_ONLY_ANNOTATIONS,
    handler: async (args) => {
      const { bin, home, path } = getRuntime();
      const env = childEnvWithOptionalToken(home, path);
      const rawArgs = { projectId: args.projectId, environmentId: args.environmentId };

      if (args.request.kind === "size") {
        // "wraps db:size, issues no db:sql invocation" (magento-cloud-mcp
        // spec) — this branch never touches the dbSqlSpec/guardQuery path.
        const spec = { ...resolveSpec(bin, ["db:size"]), env };
        const stdout = await executeReadOnlyCommand({ spec, rawArgs, now });
        return { kind: "size" as const, ...parseDbSize(stdout) };
      }

      // The ONLY branch that ever touches db:sql. `dbSqlSpec`'s own
      // `argsSchema.strict().transform()` wires `guardQuery()` — an
      // unguarded query cannot reach `execFile` through this spec
      // (design.md, Decision 5).
      const spec = { ...resolveSpec(bin, ["db:sql"]), env };
      const selectRawArgs: Record<string, unknown> = { ...rawArgs, query: args.request.query };
      if (args.request.maxRows !== undefined) {
        selectRawArgs["maxRows"] = args.request.maxRows;
      }
      const stdout = await executeReadOnlyCommand({ spec, rawArgs: selectRawArgs, now });
      const rows = parseDbSqlRows(stdout);
      return { kind: "select" as const, rowCap: args.request.maxRows ?? ROW_CAP, rowsReturned: rows.length, rows };
    },
  });

  return [authStatus, listProjects, describeProject, listEnvironments, describeEnvironment, getEnvironmentConfig, getActivities, queryDatabase];
}
