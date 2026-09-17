// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The read-only command allowlist (design.md, Decision 3; magento-cloud-
// client spec, "Read-Only Allowlist Excludes Every Mutating and
// Passthrough Subcommand"). `READ_ONLY_SUBCOMMANDS` and
// `FORBIDDEN_SUBCOMMANDS` are the two `as const` literals that are this
// module's only source of truth — `commands.test-d.ts` proves at compile
// time that their key sets cannot overlap, `commands.test.ts` proves at
// runtime that every registered key matches the read-only literal exactly
// and that every forbidden entry resolves to nothing.
//
// `mcp-core`'s own `FORBIDDEN_TOKENS` (`ssh`, `tunnel`, `db:dump`) already
// rejects those three at registration time (`allowlist.ts`); the allowlist
// below is otherwise a closed DEFAULT-DENY set — an unregistered command
// simply does not exist. `FORBIDDEN_SUBCOMMANDS` therefore does not need to
// (and does not attempt to) enumerate every open-ended mutating prefix
// family the client spec names (`snapshot:*`, `mount:*`, `local:*`,
// `server:*`, `self:*`, every mutating `environment:*`/`user:*`/`team:*`/
// `organization:*`/`integration:*`/`resources:*` form): those are proven
// absent structurally, by never being registered at all. What IS listed
// here, verbatim, is every subcommand the client spec names EXPLICITLY as
// requiring its own rejection test (tasks.md 3.4) — the five `tunnel:*`
// forms, the SSH family, `db:dump`, and the CLI's own four generic REST
// passthroughs, which are the same unconstrained shape `mcp-core`'s
// forbidden-token check bans a raw `ssh` tool for.
import { z } from "zod";
import { CommandAllowlist, type CommandSpec } from "@hiberus-magento/mcp-core";
import { guardQuery } from "./sql/guard.js";

export const READ_ONLY_SUBCOMMANDS = [
  ["auth:info", "--no-auto-login"],
  ["project:list"],
  ["project:info"],
  ["environment:list"],
  ["environment:info"],
  ["environment:url"],
  ["environment:relationships"],
  ["activity:list"],
  ["activity:log"],
  ["activity:get"],
  ["variable:list"],
  ["variable:get"],
  ["route:list"],
  ["service:list"],
  ["app:config-get"],
  ["db:size"],
  ["db:sql"],
  ["subscription:info"],
] as const;

export const FORBIDDEN_SUBCOMMANDS = [
  ["ssh"],
  ["environment:ssh"],
  ["environment:scp"],
  ["environment:drush"],
  ["tunnel:list"],
  ["tunnel:open"],
  ["tunnel:close"],
  ["tunnel:info"],
  ["tunnel:single"],
  ["db:dump"],
  ["api:curl"],
  ["project:curl"],
  ["organization:curl"],
  ["environment:curl"],
] as const;

export type ReadOnlyKey = (typeof READ_ONLY_SUBCOMMANDS)[number][0];
export type ForbiddenKey = (typeof FORBIDDEN_SUBCOMMANDS)[number][0];

// Chosen, not a round number (tasks.md 5.18), each with a stated rationale
// — mirroring `packages/aco/src/client/rate-limiter.ts`'s pace constants
// (read-only precedent for "documented chosen, not derived").
//
// ROW_CAP: weighed against a diagnostic query's REVIEWABLE size. An agent
// or a human skimming a tool result should be able to scan the full row
// set without scrolling past what a single MCP response reasonably
// renders. 200 rows is comfortably inside that while still wide enough for
// a real diagnostic query (e.g. "which orders in the last hour have a
// given status") to return a useful, non-truncated sample.
export const ROW_CAP = 200;

// DB_SQL_MAX_OUTPUT_BYTES: weighed against MCP's practical stdio-frame and
// in-memory result-object bound, not the row cap. 200 rows at a
// pessimistic ~2 KB/row (a handful of TEXT/JSON columns) is roughly
// 400 KB; 2 MiB leaves ~5x headroom for wider result sets while staying an
// order of magnitude below Node's default `execFile` maxBuffer ceiling and
// comfortably inside what an MCP client buffers for one tool result. It is
// independent of ROW_CAP by design (design.md, Decision 5): a single
// pathological row can blow the byte cap while staying under the row cap.
export const DB_SQL_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

// A read-only db:sql call over the CLI's SSH/API hop is slower than a
// simple metadata read (a diagnostic query may scan real rows), so it gets
// its own, longer budget rather than sharing DEFAULT_TIMEOUT_MS.
export const DB_SQL_TIMEOUT_MS = 30_000;

// DEFAULT_TIMEOUT_MS: generous for a single non-interactive CLI round trip
// over SSH/API (metadata reads, not data scans) — long enough to absorb
// normal network jitter, short enough that a genuinely hung call is killed
// well within an MCP client's own request patience.
export const DEFAULT_TIMEOUT_MS = 15_000;

// DEFAULT_MAX_OUTPUT_BYTES: every non-db:sql read here is a bounded
// metadata listing (projects, environments, variables, routes, services) —
// never a data export — so 1 MiB is generous headroom over any real
// listing's size while still bounding a runaway/looping CLI invocation.
export const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;

const projectIdSchema = z.string().min(1);
const environmentIdSchema = z.string().min(1);

function withFormatTsv(argv: readonly string[]): readonly string[] {
  return [...argv, "--format=tsv"];
}

function projectScoped<A extends z.ZodRawShape>(shape: A) {
  return z.object({ projectId: projectIdSchema, ...shape }).strict();
}

function environmentScoped<A extends z.ZodRawShape>(shape: A) {
  return z.object({ projectId: projectIdSchema, environmentId: environmentIdSchema, ...shape }).strict();
}

function authInfoSpec(bin: string): CommandSpec<z.ZodObject<Record<string, never>>> {
  const argsSchema = z.object({}).strict();
  return {
    bin,
    subcommand: ["auth:info", "--no-auto-login"],
    argsSchema,
    buildArgv: () => withFormatTsv(["auth:info", "--no-auto-login"]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  };
}

function projectListSpec(bin: string): CommandSpec<z.ZodObject<Record<string, never>>> {
  const argsSchema = z.object({}).strict();
  return {
    bin,
    subcommand: ["project:list"],
    argsSchema,
    buildArgv: () => withFormatTsv(["project:list"]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  };
}

function projectInfoSpec(bin: string) {
  const argsSchema = projectScoped({});
  return {
    bin,
    subcommand: ["project:info"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) => withFormatTsv(["project:info", "--project", args.projectId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function environmentListSpec(bin: string) {
  const argsSchema = projectScoped({});
  return {
    bin,
    subcommand: ["environment:list"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) => withFormatTsv(["environment:list", "--project", args.projectId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function environmentInfoSpec(bin: string) {
  const argsSchema = environmentScoped({});
  return {
    bin,
    subcommand: ["environment:info"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) =>
      withFormatTsv(["environment:info", "--project", args.projectId, "--environment", args.environmentId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function environmentUrlSpec(bin: string) {
  const argsSchema = environmentScoped({});
  return {
    bin,
    subcommand: ["environment:url"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) =>
      withFormatTsv(["environment:url", "--project", args.projectId, "--environment", args.environmentId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function environmentRelationshipsSpec(bin: string) {
  const argsSchema = environmentScoped({});
  return {
    bin,
    subcommand: ["environment:relationships"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) =>
      withFormatTsv(["environment:relationships", "--project", args.projectId, "--environment", args.environmentId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function activityListSpec(bin: string) {
  const argsSchema = projectScoped({ environmentId: environmentIdSchema.optional() });
  return {
    bin,
    subcommand: ["activity:list"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) =>
      withFormatTsv([
        "activity:list",
        "--project",
        args.projectId,
        ...(args.environmentId ? ["--environment", args.environmentId] : []),
      ]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function activityLogSpec(bin: string) {
  const argsSchema = projectScoped({ activityId: z.string().min(1) });
  return {
    bin,
    subcommand: ["activity:log"],
    argsSchema,
    // Deliberately no --format flag: activity:log's output is plain
    // deployment-log text (see test/fake-bin/fixtures/activity-log.txt),
    // not a tabular read.
    buildArgv: (args: z.infer<typeof argsSchema>) => ["activity:log", args.activityId, "--project", args.projectId],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function activityGetSpec(bin: string) {
  const argsSchema = projectScoped({ activityId: z.string().min(1) });
  return {
    bin,
    subcommand: ["activity:get"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) =>
      withFormatTsv(["activity:get", args.activityId, "--project", args.projectId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function variableListSpec(bin: string) {
  const argsSchema = environmentScoped({});
  return {
    bin,
    subcommand: ["variable:list"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) =>
      withFormatTsv(["variable:list", "--project", args.projectId, "--environment", args.environmentId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function variableGetSpec(bin: string) {
  const argsSchema = environmentScoped({ variableName: z.string().min(1) });
  return {
    bin,
    subcommand: ["variable:get"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) =>
      withFormatTsv(["variable:get", args.variableName, "--project", args.projectId, "--environment", args.environmentId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function routeListSpec(bin: string) {
  const argsSchema = environmentScoped({});
  return {
    bin,
    subcommand: ["route:list"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) =>
      withFormatTsv(["route:list", "--project", args.projectId, "--environment", args.environmentId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function serviceListSpec(bin: string) {
  const argsSchema = environmentScoped({});
  return {
    bin,
    subcommand: ["service:list"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) =>
      withFormatTsv(["service:list", "--project", args.projectId, "--environment", args.environmentId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function appConfigGetSpec(bin: string) {
  const argsSchema = environmentScoped({});
  return {
    bin,
    subcommand: ["app:config-get"],
    argsSchema,
    // Deliberately no --format flag: app:config-get returns the app's YAML
    // configuration (see test/fake-bin/fixtures/app-config-get.txt), not a
    // tabular read.
    buildArgv: (args: z.infer<typeof argsSchema>) => [
      "app:config-get",
      "--project",
      args.projectId,
      "--environment",
      args.environmentId,
    ],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function dbSizeSpec(bin: string) {
  const argsSchema = environmentScoped({});
  return {
    bin,
    subcommand: ["db:size"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) =>
      withFormatTsv(["db:size", "--project", args.projectId, "--environment", args.environmentId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function subscriptionInfoSpec(bin: string) {
  const argsSchema = projectScoped({});
  return {
    bin,
    subcommand: ["subscription:info"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) => withFormatTsv(["subscription:info", "--project", args.projectId]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

// db:sql — the guard is placed INSIDE this schema's own `.transform()`, per
// design.md Decision 5: `mcp-core`'s `validateArgv()` already runs
// `argsSchema.safeParse` before `buildArgv`, and provably never calls
// `buildArgv` on a schema failure. Placing `guardQuery()` here — rather
// than in a tool handler a future caller could skip, or inside `buildArgv`
// itself, which has no way to signal rejection past `validateArgv`'s
// `Result` contract — is what makes an unguarded query reaching `execFile`
// impossible through this spec, not merely unlikely.
function dbSqlSpec(bin: string) {
  const rawArgsSchema = z.object({
    projectId: projectIdSchema,
    environmentId: environmentIdSchema,
    query: z.string().min(1),
    maxRows: z.number().int().positive().max(ROW_CAP).optional(),
  });
  const argsSchema = rawArgsSchema.strict().transform((value, ctx) => {
    const guarded = guardQuery(value.query, { rowCap: value.maxRows ?? ROW_CAP });
    if (!guarded.ok) {
      ctx.addIssue({ code: "custom", message: guarded.message });
      return z.NEVER;
    }
    return { projectId: value.projectId, environmentId: value.environmentId, query: guarded.query };
  });
  return {
    bin,
    subcommand: ["db:sql"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) => [
      "db:sql",
      "--project",
      args.projectId,
      "--environment",
      args.environmentId,
      "--raw",
      args.query,
    ],
    timeoutMs: DB_SQL_TIMEOUT_MS,
    maxOutputBytes: DB_SQL_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function buildReadOnlySpecs(bin: string): ReadonlyArray<CommandSpec<z.ZodTypeAny>> {
  return [
    authInfoSpec(bin),
    projectListSpec(bin),
    projectInfoSpec(bin),
    environmentListSpec(bin),
    environmentInfoSpec(bin),
    environmentUrlSpec(bin),
    environmentRelationshipsSpec(bin),
    activityListSpec(bin),
    activityLogSpec(bin),
    activityGetSpec(bin),
    variableListSpec(bin),
    variableGetSpec(bin),
    routeListSpec(bin),
    serviceListSpec(bin),
    appConfigGetSpec(bin),
    dbSizeSpec(bin),
    dbSqlSpec(bin),
    subscriptionInfoSpec(bin),
  ] as unknown as ReadonlyArray<CommandSpec<z.ZodTypeAny>>;
}

export function createMagentoCloudAllowlist(bin: string): CommandAllowlist {
  const allowlist = new CommandAllowlist();
  for (const spec of buildReadOnlySpecs(bin)) {
    allowlist.register(spec);
  }
  return allowlist;
}

export interface ReadOnlyIsolationViolation {
  readonly commandKey: string;
}

/**
 * Registry-introspection check (never used by the executor itself, exactly
 * like `CommandAllowlist.listCommandKeys()` it is built on): returns every
 * registered key that is NOT in the expected read-only set. Proven with a
 * positive control in `commands.test.ts` — fed a deliberately contaminated
 * key list, it returns exactly one violation, so this is not a no-op.
 */
export function checkReadOnlyIsolation(options: {
  readonly registeredCommandKeys: readonly string[];
  readonly expectedCommandKeys: readonly string[];
}): readonly ReadOnlyIsolationViolation[] {
  const expected = new Set(options.expectedCommandKeys);
  return options.registeredCommandKeys.filter((key) => !expected.has(key)).map((commandKey) => ({ commandKey }));
}
