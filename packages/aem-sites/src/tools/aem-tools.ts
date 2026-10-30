// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The ten `aem_*` tools (aem-sites-package, spec aem-sites-mcp). Lives apart
// from `mcp.ts` for the same reason as in `eds`: `mcp.ts` connects the
// transport unconditionally at module top level (the fd-1 conformance probe
// imports the built bundle and relies on it), so it cannot also be imported
// by unit tests. This module has no side effects.
//
// Eight reads and one planner, all read-only; `aem_apply` is the only tool
// that writes, and it writes only what a plan stored.
import { CredentialExpiredError, defineTool, MissingCredentialError, redact, type RegisteredTool, type ToolCallResult } from "@hiberus-magento/mcp-core";
import { z } from "zod";
import {
  AemAuthError,
  createAemClient,
  listTemplates,
  probeAuth,
  queryPages,
  readPage,
  readPageTree,
  readSheet,
  type AemClient,
} from "../client/index.js";
import { originFor, parseConfig, type AemConfig, type EnvRecord } from "../config.js";
import { createPlanStore, type PlanStore } from "../confirm/plan-store.js";
import { createAemTokenProvider, resolveAemTokenDirect, tokenEnvVar } from "../credential-provider.js";
import { assertReadable } from "../guard/paths.js";
import { applyPlan } from "./apply.js";
import { planOperation, type StoredPlan } from "./plan-builder.js";
import { aemApplyInput, aemPlanInput, plannedPaths } from "./plan-schema.js";

export type AemMcpTool = Pick<RegisteredTool<z.ZodObject, unknown>, "name" | "description" | "inputSchema" | "annotations" | "invoke">;

export interface AemRuntime {
  readonly config: AemConfig;
  readonly clientFor: (env: string) => AemClient;
  readonly store: PlanStore<StoredPlan>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Where each environment's token would come from — never the token itself. */
  readonly tokenSource: (env: string) => "env" | "file" | "missing" | "unreadable";
}

export interface AemToolsConfig {
  /** Resolved lazily on the first tool call, so `tools/list` works before any variable is set. */
  readonly getRuntime: () => AemRuntime;
}

const env = z.string().min(1);
const readTool = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

/** Auth failures are answers, not crashes: they come back as a result naming the env and the remedy. */
async function withAuthAnswer<T>(work: () => Promise<T>): Promise<T | { readonly status: "auth-error"; readonly reason: string; readonly message: string }> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AemAuthError) {
      return { status: "auth-error", reason: error.reason, message: error.message };
    }
    throw error;
  }
}

export function createAemTools(config: AemToolsConfig): readonly AemMcpTool[] {
  const { getRuntime } = config;
  const client = (name: string): AemClient => getRuntime().clientFor(name);

  const listEnvironments = defineTool({
    name: "aem_list_environments",
    description: `Use this first, or when you need to know which AEM author environments are configured, which are protected, the write roots, and whether each environment has a token stored (never the token). Read-only.`,
    inputSchema: z.object({}).strict(),
    annotations: readTool,
    handler: async () => {
      const runtime = getRuntime();
      return {
        environments: [...runtime.config.authors.entries()].map(([name, origin]) => ({
          env: name,
          origin,
          protected: runtime.config.protectedEnvs.includes(name),
          token: runtime.tokenSource(name),
          tokenVariable: tokenEnvVar(name),
        })),
        writeRoots: runtime.config.writeRoots,
        protectedPaths: runtime.config.protectedPaths,
        allowProtectedPublish: runtime.config.allowProtectedPublish,
        extraProperties: runtime.config.extraProperties,
      };
    },
  });

  const checkAuth = defineTool({
    name: "aem_check_auth",
    description: `Use this when a call failed with an auth error, or before a batch of work, to check that an environment's token is accepted by its author (the same QueryBuilder probe the field CLI uses). Returns ok, token-expired-or-invalid, forbidden, redirected-to-login or no-token. Read-only.`,
    inputSchema: z.object({ env }).strict(),
    annotations: readTool,
    handler: async (args) => {
      const runtime = getRuntime();
      const probeRoot = runtime.config.writeRoots[0] ?? "/content";
      try {
        const { status } = await probeAuth(client(args.env).http, probeRoot);
        return { env: args.env, verdict: "ok", status };
      } catch (error) {
        if (error instanceof AemAuthError) {
          return { env: args.env, verdict: error.reason, status: error.status, remedy: error.remedy.cliCommand };
        }
        if (error instanceof MissingCredentialError || error instanceof CredentialExpiredError) {
          return { env: args.env, verdict: "no-token", remedy: error.remedy.cliCommand };
        }
        throw error;
      }
    },
  });

  const listPages = defineTool({
    name: "aem_list_pages",
    description: `Use this to find the pages under a content root (paginated: limit ≤ 200, offset; childrenOnly for direct children). Returns paths, titles and last-modified dates. Read-only.`,
    inputSchema: z
      .object({
        env,
        root: z.string().min(1),
        limit: z.number().int().positive().max(200).optional(),
        offset: z.number().int().nonnegative().optional(),
        childrenOnly: z.boolean().optional(),
      })
      .strict(),
    annotations: readTool,
    handler: async (args) =>
      withAuthAnswer(() =>
        queryPages(client(args.env).http, {
          root: assertReadable(args.root),
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.offset !== undefined ? { offset: args.offset } : {}),
          ...(args.childrenOnly !== undefined ? { childrenOnly: args.childrenOnly } : {}),
        }),
      ),
  });

  const getPage = defineTool({
    name: "aem_get_page",
    description: `Use this to read one page's properties (title, description, robots, tags, template, lock) and its replication state on preview and publish. Read-only.`,
    inputSchema: z.object({ env, path: z.string().min(1) }).strict(),
    annotations: readTool,
    handler: async (args) =>
      withAuthAnswer(async () => (await readPage(client(args.env).http, assertReadable(args.path), getRuntime().config.extraProperties)) ?? { path: args.path, exists: false }),
  });

  const getReplicationStatus = defineTool({
    name: "aem_get_replication_status",
    description: `Use this to check whether up to 100 pages are published on preview and publish, instead of calling aem_get_page in a loop. Read-only.`,
    inputSchema: z.object({ env, paths: plannedPaths }).strict(),
    annotations: readTool,
    handler: async (args) =>
      withAuthAnswer(async () => {
        const http = client(args.env).http;
        const results = [];
        for (const path of [...new Set(args.paths)]) {
          const page = await readPage(http, assertReadable(path));
          results.push(page === undefined ? { path, exists: false } : { path, exists: true, ...page.replication });
        }
        return { pages: results };
      }),
  });

  const getSheet = defineTool({
    name: "aem_get_sheet",
    description: `Use this to read a sheet page's columns and rows — for example the EDS bulk metadata sheet whose "/**" row can carry Robots: noindex for a whole site. Read-only.`,
    inputSchema: z.object({ env, path: z.string().min(1) }).strict(),
    annotations: readTool,
    handler: async (args) => withAuthAnswer(async () => (await readSheet(client(args.env).http, assertReadable(args.path))) ?? { path: args.path, exists: false }),
  });

  const listTemplatesTool = defineTool({
    name: "aem_list_templates",
    description: `Use this before planning page.create, to find template paths under a /conf root. Read-only.`,
    inputSchema: z.object({ env, confRoot: z.string().min(1) }).strict(),
    annotations: readTool,
    handler: async (args) => withAuthAnswer(async () => ({ templates: await listTemplates(client(args.env).http, args.confRoot) })),
  });

  const getPageTree = defineTool({
    name: "aem_get_page_tree",
    description: `Use this when you need a page's component tree (blocks, sections, authored text), depth 1–4. Access-control and bookkeeping properties are omitted. Read-only.`,
    inputSchema: z.object({ env, path: z.string().min(1), depth: z.number().int().min(1).max(4).optional() }).strict(),
    annotations: readTool,
    handler: async (args) =>
      withAuthAnswer(async () => (await readPageTree(client(args.env).http, assertReadable(args.path), args.depth ?? 2)) ?? { path: args.path, exists: false }),
  });

  const plan = defineTool({
    name: "aem_plan",
    description:
      "Use this whenever you want to change anything on an AEM author: page properties, robots (noindex), EDS metadata-sheet rows, publish/unpublish, create/copy/move/delete pages, create a Live Copy (MSM), or lock/unlock a page. " +
      "It reads the current state and returns exactly what would change, a confirmationMessage to show the user and a one-time token — it never writes. " +
      `Then call aem_apply only after the user explicitly confirms.`,
    inputSchema: aemPlanInput,
    annotations: readTool,
    handler: async (args) => {
      const runtime = getRuntime();
      return withAuthAnswer(() => planOperation({ config: runtime.config, clientFor: runtime.clientFor, store: runtime.store, now: runtime.now }, args));
    },
  });

  const apply = defineTool({
    name: "aem_apply",
    description:
      "Use this only after the user's most recent message explicitly confirms a plan returned by aem_plan. Pass that plan's token, env and kind (and confirmTarget, typed by the user, when the plan requires it). " +
      `It sends exactly the planned requests and nothing else; a stale, expired, reused or forged token writes nothing. Writes to the AEM author.`,
    inputSchema: aemApplyInput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler: async (args) => {
      const runtime = getRuntime();
      return withAuthAnswer(() => applyPlan({ config: runtime.config, clientFor: runtime.clientFor, store: runtime.store, sleep: runtime.sleep }, args));
    },
  });

  return [listEnvironments, checkAuth, listPages, getPage, getReplicationStatus, getSheet, listTemplatesTool, getPageTree, plan, apply];
}

/** Second, independent net under the projections: nothing a tool returns can carry a bearer. */
export function redactResult(result: ToolCallResult): ToolCallResult {
  return { ...result, content: result.content.map((part) => ({ ...part, text: redact(part.text) })) };
}

/**
 * Resolved lazily on the first tool call: `tools/list` must work before
 * `AEM_AUTHORS` is set (the conformance suite spawns with only `PATH`).
 * A malformed configuration is still caught at startup by `mcp.ts`.
 */
export function createRuntimeResolver(source: EnvRecord = process.env): () => AemRuntime {
  let runtime: AemRuntime | undefined;
  return () => {
    if (runtime !== undefined) {
      return runtime;
    }
    const config = parseConfig(source);
    const clients = new Map<string, AemClient>();
    const now = () => Date.now();
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    runtime = {
      config,
      clientFor: (name) => {
        const cached = clients.get(name);
        if (cached !== undefined) {
          return cached;
        }
        const created = createAemClient({ fetch: globalThis.fetch, now, sleep, tokenProvider: createAemTokenProvider(name), origin: originFor(config, name) });
        clients.set(name, created);
        return created;
      },
      store: createPlanStore<StoredPlan>({ now }),
      now,
      sleep,
      tokenSource: (name) => {
        if ((source[tokenEnvVar(name)] ?? "") !== "") {
          return "env";
        }
        try {
          resolveAemTokenDirect(name);
          return "file";
        } catch (error) {
          return error instanceof MissingCredentialError ? "missing" : "unreadable";
        }
      },
    };
    return runtime;
  };
}
