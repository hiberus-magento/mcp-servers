// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `aem_plan` (aem-sites-package design.md, D1, D4, D5, D8). Reads what the
// operation depends on, builds the exact write requests through the guarded
// builders, fingerprints the state the user reviews, assembles the
// confirmation message and stores the plan under a one-time token. It never
// writes: every client call here is a read, and the writes are only BUILT.
import {
  buildCopyPage,
  buildCreateLiveCopy,
  buildRollout,
  buildSetRolloutConfigs,
  buildCreatePage,
  buildCreateSheet,
  buildDeletePage,
  buildLockPage,
  buildMovePage,
  buildReplicate,
  buildSetComponentProperties,
  buildSetProperties,
  buildSetRobots,
  buildSheetColumns,
  buildSheetDeleteRow,
  buildSheetRow,
  InvalidOperationError,
  nextRowNode,
  parseRobots,
  queryPages,
  queryPublishedPages,
  confExists,
  readComponent,
  readCurrentUser,
  readPage,
  readSheet,
  type AemClient,
  type ComponentDetails,
  type PageDetails,
  type PlannedRequest,
  type ReplicationAgent,
  type Sheet,
  type WriteScope,
} from "../client/index.js";
import { AemConfigError, type AemConfig } from "../config.js";
import { fingerprint } from "../confirm/fingerprint.js";
import type { PlanStore } from "../confirm/plan-store.js";
import {
  assertWritable,
  BUILTIN_ROLLOUT_CONFIGS,
  InvalidAemPathError,
  InvalidComponentPathError,
  InvalidRolloutConfigError,
  PathNotReadableError,
  PathOutsideWriteRootsError,
  protectedPatternFor,
} from "../guard/paths.js";
import { ForbiddenPropertyNameError, InvalidPropertyValueError, assertSheetColumn } from "../guard/properties.js";
import type { RolloutTarget } from "./jobs.js";
import type { AemPlanInput, OperationKind, PlanOperation, SinglePlanOperation } from "./plan-schema.js";

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
/** A batch is reviewed as a whole and can take many minutes to apply, so its token lives longer than a single plan's. */
export const BATCH_TTL_MS = 60 * 60 * 1000;
export const BATCH_WARNING =
  "A batch is planned operation by operation when it is applied, against the author's state at that moment: the exact requests are not listed here. It stops at the first operation that is rejected or fails; what ran before is not rolled back.";
/**
 * An author answers a read right after a write with the old state for a moment
 * (observed 2026-10-29: a page created by one operation was "not found" by the
 * next). A batch operation rejected as `not-found` is re-planned this many times.
 */
export const BATCH_READ_RETRIES = 5;
export const BATCH_READ_RETRY_MS = 2000;
/** Upper bound on QueryBuilder pages read for one tree, so a wrong root cannot loop for ever. */
const MAX_TREE_QUERIES = 100;
export const CONF_WARNING =
  "cq:conf decides which /conf tree the page and every page below it use: the Edge Delivery Services site the author publishes them to, and their editable templates.";
export const FORCE_DELETE_WARNING =
  "Forced: the author deletes these pages even when other pages or Live Copies reference them; those references are left broken.";
export const DELETE_REFERENCED_HINT =
  "The author refuses to delete a page that other pages or Live Copies reference (links between the deleted pages count too). To delete it anyway, plan page.delete again with force: true and show the user that plan.";

/** Pause between the preview and publish agents (field finding: publish right after preview answered 400). */
export const AGENT_PAUSE_MS = 1_000;

export type StateCheck =
  | { readonly kind: "page"; readonly path: string; readonly sha256: string }
  | { readonly kind: "page-present"; readonly path: string }
  | { readonly kind: "page-absent"; readonly path: string }
  | { readonly kind: "component"; readonly path: string; readonly sha256: string }
  | { readonly kind: "sheet"; readonly path: string; readonly sha256: string }
  | { readonly kind: "sheet-absent"; readonly path: string };

export interface PlannedStep {
  readonly request: PlannedRequest;
  readonly pauseBeforeMs?: number;
  /** Appended to the failure message when the author answers this step with that HTTP status. */
  readonly hints?: Readonly<Record<number, string>>;
  /**
   * The request starts an async rollout job. Apply records it, and with
   * `wait` polls until each target's `cq:lastRolledout` differs from `before`.
   */
  readonly rollout?: { readonly source: string; readonly deep: boolean; readonly wait: boolean; readonly targets: readonly RolloutTarget[] };
}

export interface StoredPlan {
  readonly env: string;
  readonly kind: OperationKind;
  readonly steps: readonly PlannedStep[];
  readonly checks: readonly StateCheck[];
  /** A batch stores its operations, not requests: each is planned against the author's state when it is applied. */
  readonly batch?: readonly SinglePlanOperation[];
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
  | "locked-by-other"
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
  if (error instanceof InvalidAemPathError || error instanceof InvalidComponentPathError || error instanceof PathNotReadableError) {
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
  if (error instanceof InvalidOperationError || error instanceof InvalidRolloutConfigError) {
    return new PlanRejection("invalid-operation", error.message);
  }
  return undefined;
}

// ---------------------------------------------------------------------------

export interface Draft {
  readonly steps: readonly PlannedStep[];
  readonly checks: readonly StateCheck[];
  readonly changes: readonly Change[];
  readonly targets: readonly string[];
  readonly summary: string;
  readonly warnings?: readonly string[];
}

type Context = { readonly client: AemClient; readonly scope: WriteScope; readonly config: AemConfig };

export const LIVE_COPY_NOTE =
  "A Live Copy inherits its content from the source: editing an inherited component requires an author to cancel inheritance, and a rollout from the source overwrites inherited content. The new page is not published.";
export const COMPONENT_INHERITANCE_WARNING =
  "If this page is a Live Copy, the component is inherited: the next rollout from its source overwrites this edit unless an author cancels the component's inheritance in the editor.";
export const ROLLOUT_WARNING =
  "A rollout overwrites the inherited content of every target with the source's; components whose inheritance an author cancelled keep their edits. The targets are not published.";
export const ROLLOUT_ACCEPTED_NOTE =
  "Apply returns as soon as the author accepts the rollout job; the job reaches the targets minutes later. Check it with aem_get_job_status before anything that depends on the targets (or plan with wait: true).";
export const ROLLOUT_NO_WAIT_BATCH_WARNING =
  "Rollouts without wait: true do not hold up the operations after them: an operation that reads or rolls out their targets may run before the job reaches them.";
export const ROLLOUT_CONFIGS_NOTE =
  "The configs apply to the Live Copy root and to every page below it that does not set its own; nothing is rolled out by this change.";
export const PUSH_ON_MODIFY_WARNING =
  "Push on modify rolls out every saved change of the source to this Live Copy, without review. Adobe advises using it sparingly: it can slow down authoring, and the order of the resulting rollouts is not guaranteed.";
export const LOCK_NOTE =
  "A lock stops OTHER users from editing this page and the pages below it; the lock owner — the user this server's token belongs to — can still edit. It does not change permissions.";

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
const componentCheck = (component: ComponentDetails): StateCheck => ({ kind: "component", path: component.path, sha256: fingerprint(component) });
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
  const conf = op.set?.["cq:conf"];
  if (typeof conf === "string" && !(await confExists(ctx.client.http, conf))) {
    throw new PlanRejection("not-found", `There is no configuration at ${conf}.`);
  }
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
  return {
    steps: [{ request }],
    checks: [pageCheck(page)],
    changes,
    targets: [op.path],
    summary: `Change ${changes.length} page propert${changes.length === 1 ? "y" : "ies"} of ${op.path}.`,
    ...(changes.some((change) => change.what === "cq:conf") ? { warnings: [CONF_WARNING] } : {}),
  };
}

async function draftSetComponentProperties(ctx: Context, op: Extract<PlanOperation, { kind: "component.set-properties" }>): Promise<Draft> {
  // Validate the whole request first, so a forbidden name or path is rejected before any read.
  const fields = { ...(op.set !== undefined ? { set: op.set } : {}), ...(op.remove !== undefined ? { remove: op.remove } : {}) };
  buildSetComponentProperties(ctx.scope, { path: op.path, ...fields });
  const component = await readComponent(ctx.client.http, op.path);
  if (component === undefined) {
    throw new PlanRejection("not-found", `There is no component at ${op.path}. This operation edits an existing component; it never creates one.`);
  }
  const set: Record<string, unknown> = {};
  const changes: Change[] = [];
  for (const [name, value] of Object.entries(op.set ?? {})) {
    if (!sameValue(component.properties[name], value)) {
      set[name] = value;
      changes.push({ path: op.path, what: name, before: component.properties[name], after: value });
    }
  }
  const remove = (op.remove ?? []).filter((name) => component.properties[name] !== undefined);
  for (const name of remove) {
    changes.push({ path: op.path, what: name, before: component.properties[name] });
  }
  if (changes.length === 0) {
    return { steps: [], checks: [], changes, targets: [op.path], summary: `${op.path} already has these fields.` };
  }
  const request = buildSetComponentProperties(ctx.scope, { path: op.path, set, remove });
  return {
    steps: [{ request }],
    checks: [componentCheck(component)],
    changes,
    targets: [op.path],
    summary: `Change ${changes.length} field${changes.length === 1 ? "" : "s"} of the component ${op.path}.`,
    warnings: [COMPONENT_INHERITANCE_WARNING],
  };
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

/** Every page at or below `root`: QueryBuilder matches `path` as a prefix, so `queryPages` re-checks `${root}/`. */
async function listTree(ctx: Context, root: string): Promise<readonly string[]> {
  const paths = new Set<string>();
  let offset = 0;
  for (let query = 0; query < MAX_TREE_QUERIES; query += 1) {
    const page = await queryPages(ctx.client.http, { root, limit: 200, offset });
    for (const hit of page.pages) {
      paths.add(hit.path);
    }
    if (!page.more) {
      break;
    }
    offset += 200;
  }
  return [...paths].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

async function draftPublishTree(ctx: Context, op: Extract<PlanOperation, { kind: "page.publish-tree" }>): Promise<Draft> {
  assertWritable(op.root, ctx.scope.roots);
  const paths = await listTree(ctx, op.root);
  if (paths.length === 0) {
    await requirePage(ctx, op.root);
  }
  const steps: PlannedStep[] = [];
  const checks: StateCheck[] = [];
  const changes: Change[] = [];
  let warnings: readonly string[] = [];
  for (let start = 0; start < paths.length; start += 100) {
    const chunk = await draftReplicate(ctx, { kind: "page.publish", paths: paths.slice(start, start + 100), target: op.target });
    steps.push(...chunk.steps);
    checks.push(...chunk.checks);
    changes.push(...chunk.changes);
    warnings = chunk.warnings ?? [];
  }
  return {
    steps,
    checks,
    changes,
    targets: [op.root],
    summary: `Publish ${paths.length} page${paths.length === 1 ? "" : "s"} at or below ${op.root} on ${agents(op.target).join(" then ")}.`,
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
  const force = op.force === true;
  const request = buildDeletePage(ctx.scope, op.path, { force });
  const page = await requirePage(ctx, op.path);
  const published = await queryPublishedPages(ctx.client.http, op.path);
  const publishedList = `${published.length === 100 ? "At least 100" : published.length} page(s) at or below ${op.path} are published on publish`;
  const publishedSample = `${published.slice(0, 10).join(", ")}${published.length > 10 ? ` and ${published.length - 10} more` : ""}`;
  if (published.length > 0 && op.allowPublished !== true) {
    throw new PlanRejection(
      "page-is-published",
      `${publishedList} and must be unpublished first (aem_plan page.unpublish), e.g. ${publishedSample}. Only if the author refuses that unpublish, plan page.delete again with allowPublished: true and show the user that plan.`,
    );
  }
  const previewWarning = `Only publish-agent state can be checked; if any of these pages is on preview, unpublish it from preview first (preview state is ${PREVIEW_UNKNOWN}).`;
  const publishedWarning =
    published.length > 0
      ? [`${publishedList}: ${publishedSample}. They are deleted without being unpublished; if they are really live, they stay orphaned on publish (and Edge Delivery Services live).`]
      : [];
  const qualifiers = [...(force ? ["with force (references ignored)"] : []), ...(published.length > 0 ? ["including pages still marked as published"] : [])];
  return {
    steps: [force ? { request } : { request, hints: { 412: DELETE_REFERENCED_HINT } }],
    checks: [pageCheck(page)],
    changes: [{ path: op.path, what: "page", before: page.properties["jcr:title"] ?? op.path }],
    targets: [op.path],
    summary: `Delete ${op.path} and every page below it${qualifiers.length > 0 ? `, ${qualifiers.join(", ")}` : ""}.`,
    warnings: [...publishedWarning, ...(force ? [FORCE_DELETE_WARNING] : []), previewWarning],
  };
}

async function draftLiveCopy(ctx: Context, op: Extract<PlanOperation, { kind: "livecopy.create" }>): Promise<Draft> {
  const rolloutConfigs = op.rolloutConfigs ?? [BUILTIN_ROLLOUT_CONFIGS[0] as string];
  const dest = `${op.destParentPath}/${op.name}`;
  const request = buildCreateLiveCopy(ctx.scope, {
    srcPath: op.srcPath,
    destParentPath: op.destParentPath,
    name: op.name,
    title: op.title,
    rolloutConfigs,
    shallow: op.shallow ?? false,
  });
  await requirePage(ctx, op.srcPath);
  await requirePage(ctx, op.destParentPath);
  await requireAbsent(ctx, dest);
  return {
    steps: [{ request }],
    checks: [
      { kind: "page-present", path: op.srcPath },
      { kind: "page-present", path: op.destParentPath },
      { kind: "page-absent", path: dest },
    ],
    changes: [{ path: dest, what: "Live Copy", after: { master: op.srcPath, title: op.title, rolloutConfigs, includeSubpages: !(op.shallow ?? false) } }],
    targets: [dest],
    summary: `Create ${dest} as a Live Copy of ${op.srcPath}${op.shallow === true ? " (this page only)" : ""}.`,
    warnings: [LIVE_COPY_NOTE],
  };
}

async function draftRollout(ctx: Context, op: Extract<PlanOperation, { kind: "livecopy.rollout" }>): Promise<Draft> {
  const deep = op.deep ?? false;
  const targets = [...new Set(op.targets)];
  const request = buildRollout(ctx.scope, { path: op.path, targets, deep });
  await requirePage(ctx, op.path);
  const wait = op.wait ?? false;
  const before: RolloutTarget[] = [];
  for (const target of targets) {
    const page = await readPage(ctx.client.http, target, [...ctx.config.extraProperties, "cq:lastRolledout"]);
    if (page === undefined) {
      throw new PlanRejection("not-found", `There is no page at ${target}.`);
    }
    const last = page.properties["cq:lastRolledout"];
    before.push({ path: target, ...(typeof last === "string" ? { before: last } : {}) });
  }
  return {
    steps: [{ request, rollout: { source: op.path, deep, wait, targets: before } }],
    checks: [{ kind: "page-present", path: op.path }, ...targets.map((path) => ({ kind: "page-present" as const, path }))],
    changes: targets.map((path) => ({ path, what: "inherited content", after: `rolled out from ${op.path}` })),
    targets,
    summary: `Roll out ${op.path}${deep ? " and its sub-pages" : ""} to ${targets.length} Live Cop${targets.length === 1 ? "y" : "ies"}: ${targets.join(", ")}.`,
    warnings: wait ? [ROLLOUT_WARNING] : [ROLLOUT_WARNING, ROLLOUT_ACCEPTED_NOTE],
  };
}

async function draftSetRolloutConfigs(ctx: Context, op: Extract<PlanOperation, { kind: "livecopy.set-rollout-configs" }>): Promise<Draft> {
  const rolloutConfigs = [...new Set(op.rolloutConfigs)];
  const request = buildSetRolloutConfigs(ctx.scope, { path: op.path, rolloutConfigs });
  const page = await requirePage(ctx, op.path);
  if (page.liveCopy === undefined) {
    throw new PlanRejection("invalid-operation", `${op.path} is not the root of a Live Copy (it has no cq:LiveSyncConfig); set the configs on the root it belongs to.`);
  }
  const before = page.liveCopy.rolloutConfigs;
  if (sameValue(before, rolloutConfigs)) {
    return { steps: [], checks: [], changes: [], targets: [op.path], summary: `${op.path} already has these rollout configs.` };
  }
  return {
    steps: [{ request }],
    checks: [pageCheck(page)],
    changes: [{ path: op.path, what: "rollout configs", before, after: rolloutConfigs }],
    targets: [op.path],
    summary: `Set the rollout configs of the Live Copy ${op.path} (source ${page.liveCopy.master}) to ${rolloutConfigs.join(", ")}.`,
    warnings: [ROLLOUT_CONFIGS_NOTE, ...(rolloutConfigs.some((config) => config.endsWith("/pushonmodify")) ? [PUSH_ON_MODIFY_WARNING] : [])],
  };
}

async function draftLock(ctx: Context, op: Extract<PlanOperation, { kind: "page.lock" | "page.unlock" }>): Promise<Draft> {
  const lock = op.kind === "page.lock";
  const request = buildLockPage(ctx.scope, op.path, lock);
  const page = await requirePage(ctx, op.path);
  const owner = page.properties["jcr:lockOwner"] as string | undefined;
  const me = await readCurrentUser(ctx.client.http);
  if (owner !== undefined && owner !== me) {
    throw new PlanRejection("locked-by-other", `${op.path} is locked by ${owner}; only that user (or an administrator, in the Sites console) can unlock it.`);
  }
  const done = lock ? owner === me : owner === undefined;
  if (done) {
    return { steps: [], checks: [], changes: [], targets: [op.path], summary: lock ? `${op.path} is already locked by ${me}.` : `${op.path} is not locked.` };
  }
  return {
    steps: [{ request }],
    checks: [pageCheck(page)],
    changes: [{ path: op.path, what: "lock owner", before: owner, after: lock ? me : undefined }],
    targets: [op.path],
    summary: `${lock ? "Lock" : "Unlock"} ${op.path}${lock ? ` as ${me}` : ""}.`,
    warnings: lock ? [LOCK_NOTE] : [],
  };
}

function draftFor(ctx: Context, op: SinglePlanOperation): Promise<Draft> {
  switch (op.kind) {
    case "page.set-properties":
      return draftSetProperties(ctx, op);
    case "component.set-properties":
      return draftSetComponentProperties(ctx, op);
    case "page.set-robots":
      return draftSetRobots(ctx, op);
    case "sheet.upsert-row":
      return draftSheetUpsert(ctx, op);
    case "sheet.delete-row":
      return draftSheetDelete(ctx, op);
    case "page.publish":
    case "page.unpublish":
      return draftReplicate(ctx, op);
    case "page.publish-tree":
      return draftPublishTree(ctx, op);
    case "page.create":
      return draftCreate(ctx, op);
    case "page.copy":
    case "page.move":
      return draftCopyOrMove(ctx, op);
    case "page.delete":
      return draftDelete(ctx, op);
    case "livecopy.create":
      return draftLiveCopy(ctx, op);
    case "livecopy.rollout":
      return draftRollout(ctx, op);
    case "livecopy.set-rollout-configs":
      return draftSetRolloutConfigs(ctx, op);
    case "page.lock":
    case "page.unlock":
      return draftLock(ctx, op);
  }
}

/**
 * What a batch can check before anything runs: the guards every builder
 * applies (write roots, path grammar, property names, operators, rollout
 * configs) and the protected-publish rule. Reads wait for apply time, since
 * an operation may depend on pages an earlier one creates. Returns the
 * operation's target paths.
 */
function staticCheck(ctx: Context, op: SinglePlanOperation): readonly string[] {
  const { scope } = ctx;
  const guardPublish = (path: string): void => {
    const pattern = protectedPatternFor(path, ctx.config.protectedPaths);
    if (pattern !== undefined && !ctx.config.allowProtectedPublish) {
      throw new PlanRejection("protected-path-publish", `${path} is under the protected path ${pattern}: publishing it through this server is blocked (AEM_ALLOW_PROTECTED_PUBLISH is not set).`);
    }
  };
  switch (op.kind) {
    case "page.set-properties":
      buildSetProperties(scope, { path: op.path, ...(op.set !== undefined ? { set: op.set } : {}), ...(op.remove !== undefined ? { remove: op.remove } : {}) });
      return [op.path];
    case "component.set-properties":
      buildSetComponentProperties(scope, { path: op.path, ...(op.set !== undefined ? { set: op.set } : {}), ...(op.remove !== undefined ? { remove: op.remove } : {}) });
      return [op.path];
    case "page.set-robots":
      for (const path of op.paths) {
        buildSetRobots(scope, path, op.robots);
      }
      return op.paths;
    case "sheet.upsert-row":
      assertWritable(op.sheetPath, scope.roots);
      [op.match.column, ...Object.keys(op.values)].forEach((column) => assertSheetColumn(column));
      return [op.sheetPath];
    case "sheet.delete-row":
      assertWritable(op.sheetPath, scope.roots);
      assertSheetColumn(op.match.column);
      return [op.sheetPath];
    case "page.publish":
    case "page.unpublish":
      for (const path of op.paths) {
        buildReplicate(scope, path, "Activate", "publish");
        if (op.kind === "page.publish") {
          guardPublish(path);
        }
      }
      return op.paths;
    case "page.publish-tree":
      assertWritable(op.root, scope.roots);
      guardPublish(op.root);
      return [op.root];
    case "page.create": {
      buildCreatePage(scope, op);
      const path = `${op.parentPath}/${op.name}`;
      if (op.properties !== undefined && Object.keys(op.properties).length > 0) {
        buildSetProperties(scope, { path, set: op.properties });
      }
      return [path];
    }
    case "page.copy":
    case "page.move": {
      const destName = op.destName ?? leafOf(op.srcPath);
      if (op.kind === "page.copy") {
        buildCopyPage(scope, { srcPath: op.srcPath, destParentPath: op.destParentPath, destName, shallow: op.shallow ?? false });
      } else {
        buildMovePage(scope, { srcPath: op.srcPath, destParentPath: op.destParentPath, destName });
      }
      return [`${op.destParentPath}/${destName}`];
    }
    case "page.delete":
      buildDeletePage(scope, op.path, { force: op.force === true });
      return [op.path];
    case "livecopy.create":
      buildCreateLiveCopy(scope, {
        srcPath: op.srcPath,
        destParentPath: op.destParentPath,
        name: op.name,
        title: op.title,
        rolloutConfigs: op.rolloutConfigs ?? [BUILTIN_ROLLOUT_CONFIGS[0] as string],
        shallow: op.shallow ?? false,
      });
      return [`${op.destParentPath}/${op.name}`];
    case "livecopy.rollout":
      buildRollout(scope, { path: op.path, targets: op.targets, deep: op.deep ?? false });
      return [...op.targets];
    case "livecopy.set-rollout-configs":
      buildSetRolloutConfigs(scope, { path: op.path, rolloutConfigs: op.rolloutConfigs });
      return [op.path];
    case "page.lock":
    case "page.unlock":
      buildLockPage(scope, op.path, op.kind === "page.lock");
      return [op.path];
  }
}

/** One line per operation in a batch's confirmation: its kind, its target and the options that change what it does. */
function describeOperation(op: SinglePlanOperation): string {
  const { kind, ...rest } = op;
  const target =
    "path" in rest ? rest.path : "sheetPath" in rest ? rest.sheetPath : "root" in rest ? rest.root : "paths" in rest ? rest.paths.join(", ") : "srcPath" in rest ? `${rest.srcPath} → ${rest.destParentPath}/${"name" in rest ? rest.name : (rest.destName ?? leafOf(rest.srcPath))}` : `${rest.parentPath}/${rest.name}`;
  const omit = new Set(["path", "sheetPath", "root", "paths", "srcPath", "destParentPath", "name", "destName", "parentPath"]);
  const options = Object.entries(rest).filter(([key]) => !omit.has(key));
  return `${kind} ${target}${options.length > 0 ? ` ${JSON.stringify(Object.fromEntries(options))}` : ""}`;
}

/** Whether a path is one of `paths`, or inside or above one of them. */
function overlaps(path: string, paths: readonly string[]): boolean {
  return paths.some((other) => `${path}/`.startsWith(`${other}/`) || `${other}/`.startsWith(`${path}/`));
}

/**
 * Whether an operation touches, reads or rolls out from a page that an
 * earlier rollout without `wait` updates: it may run before the job does.
 */
function dependsOnUnwaitedRollout(operations: readonly SinglePlanOperation[], targetsByOperation: readonly (readonly string[])[]): boolean {
  const updating: string[] = [];
  for (const [index, op] of operations.entries()) {
    const paths = [...(targetsByOperation[index] ?? []), ...("srcPath" in op ? [op.srcPath] : op.kind === "livecopy.rollout" ? [op.path] : [])];
    if (paths.some((path) => overlaps(path, updating))) {
      return true;
    }
    if (op.kind === "livecopy.rollout" && op.wait !== true) {
      updating.push(...op.targets);
    }
  }
  return false;
}

function planBatch(deps: PlanDeps, ctx: Context, env: string, operations: readonly SinglePlanOperation[]): PlanResult {
  const targetsByOperation: (readonly string[])[] = [];
  for (const [index, op] of operations.entries()) {
    try {
      targetsByOperation.push(staticCheck(ctx, op));
    } catch (error) {
      const rejection = rejectionFor(error);
      if (rejection !== undefined) {
        throw new PlanRejection(rejection.reason, `operation ${index + 1} (${op.kind}): ${rejection.message}`);
      }
      throw error;
    }
  }
  const confirmTarget = confirmTargetFor(deps.config, env, targetsByOperation.flat());
  const warnings = [BATCH_WARNING, ...(dependsOnUnwaitedRollout(operations, targetsByOperation) ? [ROLLOUT_NO_WAIT_BATCH_WARNING] : [])];
  const stored: StoredPlan = { env, kind: "batch", steps: [], checks: [], batch: operations, ...(confirmTarget !== undefined ? { confirmTarget } : {}) };
  const { token, expiresAt } = deps.store.put(stored, { ttlMs: BATCH_TTL_MS });
  const summary = `Apply ${operations.length} operation${operations.length === 1 ? "" : "s"} in order.`;
  const lines = [`AEM author "${env}": ${summary}`, "", ...operations.map((op, index) => `${index + 1}. ${describeOperation(op)}`), "", ...warnings.map((warning) => `⚠ ${warning}`), ""];
  lines.push(confirmTarget !== undefined ? `This touches a protected ${confirmTarget === env ? "environment" : "path"}. To confirm, type: ${confirmTarget}` : "Reply yes to apply exactly these operations.");
  return {
    status: "planned",
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    env,
    kind: "batch",
    summary,
    changes: operations.map((op, index) => ({ path: targetsByOperation[index]?.[0] ?? "", what: op.kind, after: describeOperation(op) })),
    requests: [],
    warnings,
    confirmationMessage: lines.join("\n"),
    instruction: PLAN_INSTRUCTION,
    requiresConfirmTarget: confirmTarget !== undefined,
  };
}

/** Plans one operation of an approved batch when its turn comes; used by `aem_apply`. */
export async function draftBatchOperation(deps: Pick<PlanDeps, "config" | "clientFor">, env: string, op: SinglePlanOperation): Promise<Draft> {
  return draftFor(contextFor(deps, env), op);
}

function contextFor(deps: Pick<PlanDeps, "config" | "clientFor">, env: string): Context {
  return {
    client: deps.clientFor(env),
    scope: { roots: deps.config.writeRoots, extraProperties: deps.config.extraProperties, extraRolloutConfigs: deps.config.extraRolloutConfigs },
    config: deps.config,
  };
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
    const ctx = contextFor(deps, input.env);
    if (input.operation.kind === "batch") {
      return planBatch(deps, ctx, input.env, input.operation.operations);
    }
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
