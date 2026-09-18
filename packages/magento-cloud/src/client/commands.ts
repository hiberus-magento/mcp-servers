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

// ACTIVITY_LIMIT_MAX: chosen, not a round default (the CLI's own `--limit`
// default is 10). Weighed the same way ROW_CAP was — against what an agent
// or a human can actually read in one tool result. 100 activity rows is a
// long-but-scannable deployment history, and the loader pages the API to
// satisfy it, so a larger number buys round trips rather than insight.
export const ACTIVITY_LIMIT_MAX = 100;

// The `--state` and `--result` values the Adobe Commerce Cloud CLI 1.47.0
// reference documents, and ONLY those.
//
// Deliberately excluded: `staged` (present in upstream platformsh/legacy-cli
// shell completion) and `scheduled` (present in the Platform.sh activity API
// reference). Three sources disagree about a fifth state, the CLI does no
// client-side validation of its own, and this package has already shipped
// once on "the upstream source probably says what the fork does". Four
// documented values that certainly work beat five where one might not.
export const ACTIVITY_STATES = ["in_progress", "pending", "complete", "cancelled"] as const;
export const ACTIVITY_RESULTS = ["success", "failure"] as const;

// `--type` is NOT an enum. The CLI checks a value against a hardcoded type
// list only to expand wildcards, and sends an unrecognised one to the API
// anyway — so an allowlist copied from upstream would be a guess about the
// fork's list wearing the costume of a validation. What IS worth enforcing
// is the SHAPE: a single dotted lowercase identifier such as
// `environment.push` or `environment.update.http_access`. That rejects a
// flag-shaped value the CLI's own option parser could read as an option,
// and rejects the comma/whitespace-separated multi-value form, which this
// schema does not model.
const ACTIVITY_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)*$/;

const activityFilterShape = {
  limit: z.number().int().positive().max(ACTIVITY_LIMIT_MAX).optional(),
  type: z.string().regex(ACTIVITY_TYPE_PATTERN).optional(),
  state: z.enum(ACTIVITY_STATES).optional(),
  result: z.enum(ACTIVITY_RESULTS).optional(),
};

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

// `environment:url` and `environment:relationships` REJECT `--format`: the
// CLI answers `[RuntimeException] The "--format" option does not exist.` and
// exits non-zero, so every call carrying it failed outright. `environment:url`
// takes `--pipe` instead (one bare URL per line); `environment:relationships`
// takes no format flag at all and prints YAML.
function environmentUrlSpec(bin: string) {
  const argsSchema = environmentScoped({});
  return {
    bin,
    subcommand: ["environment:url"],
    argsSchema,
    buildArgv: (args: z.infer<typeof argsSchema>) => [
      "environment:url",
      "--project",
      args.projectId,
      "--environment",
      args.environmentId,
      "--pipe",
    ],
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
    buildArgv: (args: z.infer<typeof argsSchema>) => [
      "environment:relationships",
      "--project",
      args.projectId,
      "--environment",
      args.environmentId,
    ],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function activityListSpec(bin: string) {
  const argsSchema = projectScoped({ environmentId: environmentIdSchema.optional(), ...activityFilterShape });
  return {
    bin,
    subcommand: ["activity:list"],
    argsSchema,
    // Every filter is optional and appended only when supplied, so the argv
    // built for an unfiltered call is byte-for-byte what it was before the
    // filters existed.
    buildArgv: (args: z.infer<typeof argsSchema>) =>
      withFormatTsv([
        "activity:list",
        "--project",
        args.projectId,
        ...(args.environmentId ? ["--environment", args.environmentId] : []),
        ...(args.limit !== undefined ? ["--limit", String(args.limit)] : []),
        ...(args.type !== undefined ? ["--type", args.type] : []),
        ...(args.state !== undefined ? ["--state", args.state] : []),
        ...(args.result !== undefined ? ["--result", args.result] : []),
      ]),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  } satisfies CommandSpec<typeof argsSchema>;
}

function activityLogSpec(bin: string) {
  const argsSchema = environmentScoped({ activityId: z.string().min(1) });
  return {
    bin,
    subcommand: ["activity:log"],
    argsSchema,
    // Deliberately no --format flag: activity:log's output is plain
    // deployment-log text (see test/fake-bin/fixtures/activity-log.txt),
    // not a tabular read. The CLI has no `--format` option here at all.
    //
    // `--refresh 0` is not optional for a non-interactive caller. The CLI's
    // own `--refresh` default is 3 seconds, which makes `activity:log` POLL
    // and keep streaming while the activity is still running — it would never
    // return, and the only thing this client would ever see is its own
    // timeout. 0 is the CLI's documented "disable refreshing".
    buildArgv: (args: z.infer<typeof argsSchema>) => [
      "activity:log",
      args.activityId,
      "--project",
      args.projectId,
      "--environment",
      args.environmentId,
      "--refresh",
      "0",
    ],
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
