// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `aem_plan` (aem-sites-package design.md, D1, D4, D5, D8). Reads what the
// operation depends on, builds the exact write requests through the guarded
// builders, fingerprints the state the user reviews, assembles the
// confirmation message and stores the plan under a one-time token. It never
// writes: every client call here is a read, and the writes are only BUILT.
import {
  buildCopyPage,
  buildCreatePage,
  buildCreateSheet,
  buildDeletePage,
  buildMovePage,
  buildReplicate,
  buildSetProperties,
  buildSetRobots,
  buildSheetColumns,
  buildSheetDeleteRow,
  buildSheetRow,
  InvalidOperationError,
  nextRowNode,
  parseRobots,
  queryPublishedPages,
  readPage,
  readSheet,
  type AemClient,
  type PageDetails,
  type PlannedRequest,
  type ReplicationAgent,
  type Sheet,
  type WriteScope,
} from "../client/index.js";
import { AemConfigError, type AemConfig } from "../config.js";
import { fingerprint } from "../confirm/fingerprint.js";
import type { PlanStore } from "../confirm/plan-store.js";
import { assertWritable, InvalidAemPathError, PathOutsideWriteRootsError, protectedPatternFor } from "../guard/paths.js";
import { ForbiddenPropertyNameError, InvalidPropertyValueError, assertSheetColumn } from "../guard/properties.js";
import type { AemPlanInput, OperationKind, PlanOperation } from "./plan-schema.js";

/** Returned with every plan: a model weighs what it just received more than a description read at session start. */
export const PLAN_INSTRUCTION =
  "Show confirmationMessage to the user, translated into the user's language if needed, without summarising the changes away. " +
  "Call aem_apply only if the user's most recent message explicitly confirms this plan, passing this token with this plan's env and kind" +
  " (and confirmTarget when requiresConfirmTarget is true, typed by the user). " +
  "If the user asks for any modification, call aem_plan again; do not reuse this token.";

export const EDS_LIVE_WARNING =
  "Publishing to the publish agent also publishes to Edge Delivery Services live (*.aem.live) on an EDS-connected author.";
export const EDS_UNPUBLISH_WARNING = "Unpublishing from the publish agent removes the page from Edge Delivery Services live on an EDS-connected author.";
export const ROBOTS_UNVERIFIED_WARNING =
  "Writes the robots field of the EDS page-metadata model. That EDS renders it as <meta name=\"robots\"> once the page is published has not yet been verified on a live page; the site-wide route is a row in the EDS metadata sheet (sheet.upsert-row).";
export const PREVIEW_UNKNOWN = "unknown (AEM does not record preview replication)";

/** Pause between the preview and publish agents (field finding: publish right after preview answered 400). */
export const AGENT_PAUSE_MS = 1_000;

export type StateCheck =
  | { readonly kind: "page"; readonly path: string; readonly sha256: string }
  | { readonly kind: "page-present"; readonly path: string }
  | { readonly kind: "page-absent"; readonly path: string }
  | { readonly kind: "sheet"; readonly path: string; readonly sha256: string }
  | { readonly kind: "sheet-absent"; readonly path: string };

export interface PlannedStep {
  readonly request: PlannedRequest;
  readonly pauseBeforeMs?: number;
}

export interface StoredPlan {
  readonly env: string;
  readonly kind: OperationKind;
  readonly steps: readonly PlannedStep[];
  readonly checks: readonly StateCheck[];
  /** What the user must type when the plan touches a protected environment or path. */
  readonly confirmTarget?: string;
}

export interface Change {
  readonly path: string;
  readonly what: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export type PlanRejectionReason =
  | "unknown-env"
  | "invalid-path"
  | "path-outside-write-roots"
  | "forbidden-property-name"
  | "invalid-value"
  | "not-found"
  | "already-exists"
  | "page-is-published"
  | "protected-path-publish"
  | "invalid-operation";

export type PlanResult =
  | { readonly status: "rejected"; readonly reason: PlanRejectionReason; readonly message: string }
  | { readonly status: "no-changes"; readonly env: string; readonly kind: OperationKind; readonly summary: string }
  | {
      readonly status: "planned";
      readonly token: string;
      /** ISO 8601. */
      readonly expiresAt: string;
      readonly env: string;
      readonly kind: OperationKind;
      readonly summary: string;
      readonly changes: readonly Change[];
      readonly requests: readonly { readonly method: string; readonly path: string; readonly label: string }[];
      readonly warnings: readonly string[];
      readonly confirmationMessage: string;
      readonly instruction: string;
      readonly requiresConfirmTarget: boolean;
    };

export interface PlanDeps {
  readonly config: AemConfig;
  readonly clientFor: (env: string) => AemClient;
  readonly store: PlanStore<StoredPlan>;
  readonly now: () => number;
}

export class PlanRejection extends Error {
  readonly reason: PlanRejectionReason;

  constructor(reason: PlanRejectionReason, message: string) {
    super(message);
    this.name = "PlanRejection";
    this.reason = reason;
  }
}

/** Guard and validation errors become a structured rejection; anything else (auth, network) propagates. */
export function rejectionFor(error: unknown): PlanRejection | undefined {
  if (error instanceof PlanRejection) {
    return error;
  }
  if (error instanceof PathOutsideWriteRootsError) {
    return new PlanRejection("path-outside-write-roots", error.message);
  }
  if (error instanceof InvalidAemPathError) {
    return new PlanRejection("invalid-path", error.message);
  }
  if (error instanceof ForbiddenPropertyNameError) {
    return new PlanRejection("forbidden-property-name", error.message);
  }
  if (error instanceof InvalidPropertyValueError) {
    return new PlanRejection("invalid-value", error.message);
  }
  if (error instanceof AemConfigError) {
    return new PlanRejection("unknown-env", error.message);
  }
  if (error instanceof InvalidOperationError) {
    return new PlanRejection("invalid-operation", error.message);
  }
  return undefined;
}

// ---------------------------------------------------------------------------

interface Draft {
  readonly steps: readonly PlannedStep[];
  readonly checks: readonly StateCheck[];
  readonly changes: readonly Change[];
  readonly targets: readonly string[];
  readonly summary: string;
  readonly warnings?: readonly string[];
}

type Context = { readonly client: AemClient; readonly scope: WriteScope; readonly config: AemConfig };

function leafOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function sameValue(current: unknown, next: unknown): boolean {
  const norm = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(String);
    }
    return value === undefined ? undefined : String(value);
  };
  return JSON.stringify(norm(current)) === JSON.stringify(norm(next));
}

function sameSet(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && b.every((entry) => a.includes(entry));
}

async function requirePage(ctx: Context, path: string): Promise<PageDetails> {
  const page = await readPage(ctx.client.http, path, ctx.config.extraProperties);
  if (page === undefined) {
    throw new PlanRejection("not-found", `There is no page at ${path}.`);
  }
  return page;
}

async function requireAbsent(ctx: Context, path: string): Promise<void> {
  if ((await readPage(ctx.client.http, path, ctx.config.extraProperties)) !== undefined) {
    throw new PlanRejection("already-exists", `A page already exists at ${path}.`);
  }
}

const pageCheck = (page: PageDetails): StateCheck => ({ kind: "page", path: page.path, sha256: fingerprint(page) });
const sheetCheck = (sheet: Sheet): StateCheck => ({ kind: "sheet", path: sheet.path, sha256: fingerprint(sheet) });

function agents(target: "preview" | "publish" | "both"): readonly ReplicationAgent[] {
  return target === "both" ? ["preview", "publish"] : [target];
}

/** Publish state as recorded; preview state is never recorded by AEM, so it is `undefined` = unknown. */
function publishStateOf(page: PageDetails): string | undefined {
  return page.replication.publish.lastAction;
}

function resolveColumn(columns: readonly string[], name: string): string {
  return columns.find((column) => column.toLowerCase() === name.toLowerCase()) ?? assertSheetColumn(name);
}

// ---------------------------------------------------------------------------
// Per-kind drafts
// ---------------------------------------------------------------------------

async function draftSetProperties(ctx: Context, op: Extract<PlanOperation, { kind: "page.set-properties" }>): Promise<Draft> {
  // Validate the whole request first, so a forbidden name is rejected before any read.
  buildSetProperties(ctx.scope, { path: op.path, ...(op.set !== undefined ? { set: op.set } : {}), ...(op.remove !== undefined ? { remove: op.remove } : {}) });
  const page = await requirePage(ctx, op.path);
  const set: Record<string, unknown> = {};
  const changes: Change[] = [];
  for (const [name, value] of Object.entries(op.set ?? {})) {
    if (!sameValue(page.properties[name], value)) {
      set[name] = value;
      changes.push({ path: op.path, what: name, before: page.properties[name], after: value });
    }
  }
  const remove = (op.remove ?? []).filter((name) => page.properties[name] !== undefined);
  for (const name of remove) {
    changes.push({ path: op.path, what: name, before: page.properties[name] });
  }
  if (changes.length === 0) {
    return { steps: [], checks: [], changes, targets: [op.path], summary: `${op.path} already has these properties.` };
  }
  const request = buildSetProperties(ctx.scope, { path: op.path, set, remove });
  return { steps: [{ request }], checks: [pageCheck(page)], changes, targets: [op.path], summary: `Change ${changes.length} page propert${changes.length === 1 ? "y" : "ies"} of ${op.path}.` };
}

async function draftSetRobots(ctx: Context, op: Extract<PlanOperation, { kind: "page.set-robots" }>): Promise<Draft> {
  for (const path of op.paths) {
    buildSetRobots(ctx.scope, path, op.robots);
  }
  const steps: PlannedStep[] = [];
  const checks: StateCheck[] = [];
  const changes: Change[] = [];
  for (const path of [...new Set(op.paths)]) {
    const page = await requirePage(ctx, path);
    const current = parseRobots(page.properties.robots);
    const unchanged = op.robots === null ? current === undefined : sameSet(current, op.robots);
    if (unchanged) {
      continue;
    }
    steps.push({ request: buildSetRobots(ctx.scope, path, op.robots) });
    checks.push(pageCheck(page));
    changes.push({ path, what: "robots", before: page.properties.robots, after: op.robots === null ? undefined : op.robots.join(", ") });
  }
  const what = op.robots === null ? "Remove robots tags from" : `Set robots "${op.robots.join(", ")}" on`;
  return {
    steps,
    checks,
    changes,
    targets: op.paths,
    summary: steps.length === 0 ? "Every page already has these robots tags." : `${what} ${steps.length} page${steps.length === 1 ? "" : "s"}.`,
    warnings: [ROBOTS_UNVERIFIED_WARNING],
  };
}

async function draftSheetUpsert(ctx: Context, op: Extract<PlanOperation, { kind: "sheet.upsert-row" }>): Promise<Draft> {
  assertWritable(op.sheetPath, ctx.scope.roots);
  for (const column of [op.match.column, ...Object.keys(op.values)]) {
    assertSheetColumn(column);
  }
  const sheet = await readSheet(ctx.client.http, op.sheetPath);
  const columns = sheet?.columns ?? [];
  const matchColumn = resolveColumn(columns, op.match.column);
  const values: Record<string, string> = {};
  for (const [column, value] of Object.entries(op.values)) {
    const resolved = resolveColumn(columns, column);
    if (resolved !== matchColumn) {
      values[resolved] = value;
    }
  }
  const wanted = [matchColumn, ...Object.keys(values)];
  const missing = wanted.filter((column) => !columns.includes(column));
  const steps: PlannedStep[] = [];
  const changes: Change[] = [];
  const isMetadata = leafOf(op.sheetPath) === "metadata";
  const warnings = isMetadata
    ? [
        "The metadata sheet takes effect in EDS only after the sheet is published (aem_plan page.publish on the sheet) and /metadata.json is previewed and published with the eds server.",
      ]
    : [];

  if (sheet === undefined) {
    steps.push({ request: buildCreateSheet(ctx.scope, op.sheetPath) });
    changes.push({ path: op.sheetPath, what: "sheet", after: "created from the EDS metadata sheet template" });
  }
  if (missing.length > 0) {
    steps.push({ request: buildSheetColumns(ctx.scope, op.sheetPath, [...columns, ...missing]) });
    changes.push({ path: op.sheetPath, what: "columns", before: columns, after: [...columns, ...missing] });
  }
  const row = sheet?.rows.find((candidate) => candidate.values[matchColumn] === op.match.value);
  if (row === undefined) {
    const node = nextRowNode(sheet?.rows.map((r) => r.node) ?? []);
    const cells = { [matchColumn]: op.match.value, ...Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "")) };
    steps.push({ request: buildSheetRow(ctx.scope, op.sheetPath, node, cells, true) });
    changes.push({ path: op.sheetPath, what: `row ${node}`, after: cells });
  } else {
    const diff = Object.fromEntries(Object.entries(values).filter(([column, value]) => (row.values[column] ?? "") !== value));
    if (Object.keys(diff).length > 0) {
      steps.push({ request: buildSheetRow(ctx.scope, op.sheetPath, row.node, diff, false) });
      for (const [column, value] of Object.entries(diff)) {
        changes.push({ path: op.sheetPath, what: `row ${row.node} · ${column}`, before: row.values[column], after: value === "" ? undefined : value });
      }
    }
  }
  return {
    steps,
    checks: [sheet === undefined ? { kind: "sheet-absent", path: op.sheetPath } : sheetCheck(sheet)],
    changes,
    targets: [op.sheetPath],
    summary:
      steps.length === 0
        ? `The row ${op.match.column}=${op.match.value} of ${op.sheetPath} already has these values.`
        : `${row === undefined ? "Add" : "Update"} the row ${matchColumn}=${op.match.value} of ${op.sheetPath}.`,
    warnings,
  };
}

async function draftSheetDelete(ctx: Context, op: Extract<PlanOperation, { kind: "sheet.delete-row" }>): Promise<Draft> {
  assertWritable(op.sheetPath, ctx.scope.roots);
  const sheet = await readSheet(ctx.client.http, op.sheetPath);
  const column = resolveColumn(sheet?.columns ?? [], op.match.column);
  const row = sheet?.rows.find((candidate) => candidate.values[column] === op.match.value);
  if (sheet === undefined || row === undefined) {
    return { steps: [], checks: [], changes: [], targets: [op.sheetPath], summary: `${op.sheetPath} has no row ${op.match.column}=${op.match.value}.` };
  }
  return {
    steps: [{ request: buildSheetDeleteRow(ctx.scope, op.sheetPath, row.node) }],
    checks: [sheetCheck(sheet)],
    changes: [{ path: op.sheetPath, what: `row ${row.node}`, before: row.values }],
    targets: [op.sheetPath],
    summary: `Delete the row ${column}=${op.match.value} of ${op.sheetPath}.`,
  };
}

async function draftReplicate(ctx: Context, op: Extract<PlanOperation, { kind: "page.publish" | "page.unpublish" }>): Promise<Draft> {
  const publish = op.kind === "page.publish";
  const paths = [...new Set(op.paths)];
  for (const path of paths) {
    assertWritable(path, ctx.scope.roots);
    const pattern = protectedPatternFor(path, ctx.config.protectedPaths);
    if (publish && pattern !== undefined && !ctx.config.allowProtectedPublish) {
      throw new PlanRejection(
        "protected-path-publish",
        `${path} is under the protected path ${pattern}: publishing it through this server is blocked (AEM_ALLOW_PROTECTED_PUBLISH is not set).`,
      );
    }
  }
  const pages: PageDetails[] = [];
  for (const path of paths) {
    pages.push(await requirePage(ctx, path));
  }
  const steps: PlannedStep[] = [];
  const changes: Change[] = [];
  const touched = new Set<string>();
  for (const [index, agent] of agents(op.target).entries()) {
    let first = true;
    for (const page of pages) {
      // Only the publish agent's state is known; an unpublish from preview is always sent.
      if (!publish && agent === "publish" && publishStateOf(page) !== "Activate") {
        continue;
      }
      steps.push({ request: buildReplicate(ctx.scope, page.path, publish ? "Activate" : "Deactivate", agent), ...(index > 0 && first ? { pauseBeforeMs: AGENT_PAUSE_MS } : {}) });
      first = false;
      touched.add(page.path);
      const before = agent === "preview" ? PREVIEW_UNKNOWN : (publishStateOf(page) ?? "never replicated");
      changes.push({ path: page.path, what: agent, before, after: publish ? "Activate" : "Deactivate" });
    }
  }
  const warnings = op.target !== "preview" ? [publish ? EDS_LIVE_WARNING : EDS_UNPUBLISH_WARNING] : [];
  return {
    steps,
    checks: pages.filter((page) => touched.has(page.path)).map(pageCheck),
    changes,
    targets: paths,
    summary:
      steps.length === 0
        ? "None of these pages is published on publish."
        : `${publish ? "Publish" : "Unpublish"} ${touched.size} page${touched.size === 1 ? "" : "s"} on ${agents(op.target).join(" then ")}.`,
    warnings,
  };
}

async function draftCreate(ctx: Context, op: Extract<PlanOperation, { kind: "page.create" }>): Promise<Draft> {
  const path = `${op.parentPath}/${op.name}`;
  const create = buildCreatePage(ctx.scope, op);
  const props = op.properties !== undefined && Object.keys(op.properties).length > 0 ? buildSetProperties(ctx.scope, { path, set: op.properties }) : undefined;
  await requirePage(ctx, op.parentPath);
  await requireAbsent(ctx, path);
  return {
    steps: [{ request: create }, ...(props !== undefined ? [{ request: props }] : [])],
    checks: [
      { kind: "page-present", path: op.parentPath },
      { kind: "page-absent", path },
    ],
    changes: [{ path, what: "page", after: { title: op.title, template: op.template, ...(op.properties ?? {}) } }],
    targets: [path],
    summary: `Create the page ${path} from ${op.template}.`,
  };
}

async function draftCopyOrMove(ctx: Context, op: Extract<PlanOperation, { kind: "page.copy" | "page.move" }>): Promise<Draft> {
  const destName = op.destName ?? leafOf(op.srcPath);
  const dest = `${op.destParentPath}/${destName}`;
  const request =
    op.kind === "page.copy"
      ? buildCopyPage(ctx.scope, { srcPath: op.srcPath, destParentPath: op.destParentPath, destName, shallow: op.shallow ?? false })
      : buildMovePage(ctx.scope, { srcPath: op.srcPath, destParentPath: op.destParentPath, destName });
  const src = await requirePage(ctx, op.srcPath);
  await requirePage(ctx, op.destParentPath);
  await requireAbsent(ctx, dest);
  const verb = op.kind === "page.copy" ? "Copy" : "Move";
  return {
    steps: [{ request }],
    checks: [pageCheck(src), { kind: "page-present", path: op.destParentPath }, { kind: "page-absent", path: dest }],
    changes: [{ path: dest, what: "page", before: op.kind === "page.move" ? op.srcPath : undefined, after: `${op.kind === "page.copy" ? "copy" : "moved from"} ${op.srcPath}` }],
    targets: op.kind === "page.move" ? [op.srcPath, dest] : [dest],
    summary: `${verb} ${op.srcPath}${op.kind === "page.copy" && op.shallow === true ? " (this page only)" : ""} to ${dest}.`,
    warnings: op.kind === "page.move" && src.replication.publish.lastAction === "Activate" ? ["The source page is published; moving it changes its public URL."] : [],
  };
}

async function draftDelete(ctx: Context, op: Extract<PlanOperation, { kind: "page.delete" }>): Promise<Draft> {
  const request = buildDeletePage(ctx.scope, op.path);
  const page = await requirePage(ctx, op.path);
  const published = await queryPublishedPages(ctx.client.http, op.path);
  if (published.length > 0) {
    throw new PlanRejection(
      "page-is-published",
      `${published.length === 100 ? "At least 100" : published.length} page(s) at or below ${op.path} are published on publish and must be unpublished first (aem_plan page.unpublish), e.g. ${published.slice(0, 10).join(", ")}${published.length > 10 ? ` and ${published.length - 10} more` : ""}.`,
    );
  }
  return {
    steps: [{ request }],
    checks: [pageCheck(page)],
    changes: [{ path: op.path, what: "page", before: page.properties["jcr:title"] ?? op.path }],
    targets: [op.path],
    summary: `Delete ${op.path} and every page below it.`,
    warnings: [`Only publish-agent state can be checked; if any of these pages is on preview, unpublish it from preview first (preview state is ${PREVIEW_UNKNOWN}).`],
  };
}

function draftFor(ctx: Context, op: PlanOperation): Promise<Draft> {
  switch (op.kind) {
    case "page.set-properties":
      return draftSetProperties(ctx, op);
    case "page.set-robots":
      return draftSetRobots(ctx, op);
    case "sheet.upsert-row":
      return draftSheetUpsert(ctx, op);
    case "sheet.delete-row":
      return draftSheetDelete(ctx, op);
    case "page.publish":
    case "page.unpublish":
      return draftReplicate(ctx, op);
    case "page.create":
      return draftCreate(ctx, op);
    case "page.copy":
    case "page.move":
      return draftCopyOrMove(ctx, op);
    case "page.delete":
      return draftDelete(ctx, op);
  }
}

function confirmTargetFor(config: AemConfig, env: string, targets: readonly string[]): string | undefined {
  if (config.protectedEnvs.includes(env)) {
    return env;
  }
  const patterns = [...new Set(targets.map((path) => protectedPatternFor(path, config.protectedPaths)).filter((p): p is string => p !== undefined))];
  return patterns.length > 0 ? patterns.join(", ") : undefined;
}

function confirmationMessage(env: string, draft: Draft, confirmTarget: string | undefined): string {
  const lines = [`AEM author "${env}": ${draft.summary}`, ""];
  for (const change of draft.changes) {
    const before = change.before === undefined ? "—" : JSON.stringify(change.before);
    const after = change.after === undefined ? "(removed)" : JSON.stringify(change.after);
    lines.push(`• ${change.path} · ${change.what}: ${before} → ${after}`);
  }
  for (const warning of draft.warnings ?? []) {
    lines.push("", `⚠ ${warning}`);
  }
  lines.push("");
  lines.push(
    confirmTarget !== undefined
      ? `This touches a protected ${confirmTarget === env ? "environment" : "path"}. To confirm, type: ${confirmTarget}`
      : "Reply yes to apply exactly these changes.",
  );
  return lines.join("\n");
}

export async function planOperation(deps: PlanDeps, input: AemPlanInput): Promise<PlanResult> {
  try {
    if (!deps.config.authors.has(input.env)) {
      throw new PlanRejection("unknown-env", `Unknown environment "${input.env}". Configured: ${[...deps.config.authors.keys()].join(", ")}.`);
    }
    if (deps.config.writeRoots.length === 0) {
      throw new PlanRejection("path-outside-write-roots", "No write roots are configured, so nothing can be planned. Set AEM_WRITE_ROOTS (see docs/aem-sites-onboarding.md).");
    }
    const ctx: Context = {
      client: deps.clientFor(input.env),
      scope: { roots: deps.config.writeRoots, extraProperties: deps.config.extraProperties },
      config: deps.config,
    };
    const draft = await draftFor(ctx, input.operation);
    if (draft.steps.length === 0) {
      return { status: "no-changes", env: input.env, kind: input.operation.kind, summary: draft.summary };
    }
    const confirmTarget = confirmTargetFor(deps.config, input.env, draft.targets);
    const stored: StoredPlan = {
      env: input.env,
      kind: input.operation.kind,
      steps: draft.steps,
      checks: draft.checks,
      ...(confirmTarget !== undefined ? { confirmTarget } : {}),
    };
    const { token, expiresAt } = deps.store.put(stored);
    return {
      status: "planned",
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      env: input.env,
      kind: input.operation.kind,
      summary: draft.summary,
      changes: draft.changes,
      requests: draft.steps.map((step) => ({ method: step.request.method, path: step.request.path, label: step.request.label })),
      warnings: draft.warnings ?? [],
      confirmationMessage: confirmationMessage(input.env, draft, confirmTarget),
      instruction: PLAN_INSTRUCTION,
      requiresConfirmTarget: confirmTarget !== undefined,
    };
  } catch (error) {
    const rejection = rejectionFor(error);
    if (rejection !== undefined) {
      return { status: "rejected", reason: rejection.reason, message: rejection.message };
    }
    throw error;
  }
}
