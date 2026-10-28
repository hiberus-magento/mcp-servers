// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Pure request builders (aem-sites-package design.md, D3 and D4). No
// network: each returns the exact bytes `aem_apply` will later send, and
// each runs the write guard first, so a request outside the write roots or
// carrying a non-allowlisted property name is never built at all.
//
// The only Sling POST operators that ever appear in a request are emitted
// here as constants — `@TypeHint`, `@Delete` and `:operation=delete` — next
// to names that already passed `assertWritableProperty`/`assertSheetColumn`.
import { assertAemPath, assertReadable, assertRolloutConfig, assertWritable } from "../guard/paths.js";
import { assertPropertyValue, assertRobotsTokens, assertSheetColumn, assertWritableProperty, type PropertyValue } from "../guard/properties.js";
import type { FormFields } from "./http.js";

/** An operation that is well-formed JSON but not something this server will build (empty change, self-move, …). */
export class InvalidOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOperationError";
  }
}

export interface PlannedRequest {
  readonly method: "POST";
  /** Path plus query string, relative to the author origin. */
  readonly path: string;
  readonly form: FormFields;
  /** What this request does, in words — shown in the plan and named in a failure. */
  readonly label: string;
}

export interface WriteScope {
  readonly roots: readonly string[];
  readonly extraProperties: readonly string[];
  /** Rollout configs beyond AEM's four built-in ones (`AEM_EXTRA_ROLLOUT_CONFIGS`). */
  readonly extraRolloutConfigs?: readonly string[];
}

const CHARSET: readonly [string, string] = ["_charset_", "utf-8"];
const WCM_COMMAND = "/bin/wcmcommand";
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** The sheet template the field CLI created `metadata` sheets from (EDS on AEM Sites). */
export const SHEET_TEMPLATE = "/libs/core/franklin/templates/metadata";

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function leafOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function assertSegment(name: string, what: string): string {
  if (!SEGMENT.test(name)) {
    throw new InvalidOperationError(`Invalid ${what} "${name}": only letters, digits, "_" and "-".`);
  }
  return name;
}

function valueFields(name: string, value: PropertyValue): FormFields {
  if (Array.isArray(value)) {
    return [...value.map((entry) => [name, entry] as const), [`${name}@TypeHint`, "String[]"]];
  }
  if (typeof value === "boolean") {
    return [
      [name, String(value)],
      [`${name}@TypeHint`, "Boolean"],
    ];
  }
  if (typeof value === "number") {
    return [
      [name, String(value)],
      [`${name}@TypeHint`, Number.isInteger(value) ? "Long" : "Double"],
    ];
  }
  return [[name, value as string]];
}

export interface SetPropertiesInput {
  readonly path: string;
  readonly set?: Readonly<Record<string, unknown>>;
  readonly remove?: readonly string[];
}

export function buildSetProperties(scope: WriteScope, input: SetPropertiesInput): PlannedRequest {
  const path = assertWritable(input.path, scope.roots);
  const form: (readonly [string, string])[] = [];
  const set = Object.entries(input.set ?? {});
  const remove = input.remove ?? [];
  if (set.length === 0 && remove.length === 0) {
    throw new InvalidOperationError("Nothing to change: give at least one property to set or remove.");
  }
  for (const [name, raw] of set) {
    assertWritableProperty(name, scope.extraProperties);
    form.push(...valueFields(name, assertPropertyValue(name, raw)));
  }
  for (const name of remove) {
    assertWritableProperty(name, scope.extraProperties);
    if (set.some(([setName]) => setName === name)) {
      throw new InvalidOperationError(`"${name}" cannot be both set and removed.`);
    }
    form.push([`${name}@Delete`, ""]);
  }
  form.push(CHARSET);
  return { method: "POST", path: `${path}/jcr:content`, form, label: `page properties of ${path}` };
}

/**
 * Writes the `robots` text field of the EDS XWalk `page-metadata` model
 * (e.g. "noindex, nofollow") — the field the page model declares on the
 * author, observed 2026-10-28. `tokens: null` removes it.
 */
export function buildSetRobots(scope: WriteScope, path: string, tokens: readonly string[] | null): PlannedRequest {
  assertWritable(path, scope.roots);
  if (tokens === null) {
    return { method: "POST", path: `${path}/jcr:content`, form: [["robots@Delete", ""], CHARSET], label: `robots of ${path}` };
  }
  const valid = assertRobotsTokens(tokens);
  return { method: "POST", path: `${path}/jcr:content`, form: [["robots", valid.join(", ")], CHARSET], label: `robots of ${path}` };
}

/** "noindex, nofollow" → ["noindex", "nofollow"]; undefined for an absent or empty value. */
export function parseRobots(value: unknown): readonly string[] | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  return value
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== "");
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

export function buildCreateSheet(scope: WriteScope, sheetPath: string): PlannedRequest {
  assertWritable(sheetPath, scope.roots);
  const leaf = leafOf(sheetPath);
  return {
    method: "POST",
    path: WCM_COMMAND,
    form: [["cmd", "createPage"], CHARSET, ["parentPath", parentOf(sheetPath)], ["label", leaf], ["title", leaf], ["template", SHEET_TEMPLATE]],
    label: `create the sheet ${sheetPath}`,
  };
}

export function buildSheetColumns(scope: WriteScope, sheetPath: string, columns: readonly string[]): PlannedRequest {
  assertWritable(sheetPath, scope.roots);
  const valid = columns.map(assertSheetColumn);
  return {
    method: "POST",
    path: `${sheetPath}/jcr:content`,
    form: [...valid.map((column) => ["columns", column] as const), ["columns@TypeHint", "String[]"], CHARSET],
    label: `columns of ${sheetPath}`,
  };
}

/** `add: true` creates the row node; otherwise it updates the cells of an existing one. An empty value deletes the cell. */
export function buildSheetRow(scope: WriteScope, sheetPath: string, node: string, values: Readonly<Record<string, string>>, add: boolean): PlannedRequest {
  assertWritable(sheetPath, scope.roots);
  assertSegment(node, "row node");
  const form: (readonly [string, string])[] = add ? [["jcr:primaryType", "nt:unstructured"]] : [];
  for (const [column, value] of Object.entries(values)) {
    assertSheetColumn(column);
    form.push(value === "" && !add ? [`${column}@Delete`, ""] : [column, value]);
  }
  form.push(CHARSET);
  return { method: "POST", path: `${sheetPath}/jcr:content/${node}`, form, label: `${add ? "add" : "update"} row ${node} of ${sheetPath}` };
}

export function buildSheetDeleteRow(scope: WriteScope, sheetPath: string, node: string): PlannedRequest {
  assertWritable(sheetPath, scope.roots);
  assertSegment(node, "row node");
  return { method: "POST", path: `${sheetPath}/jcr:content/${node}`, form: [[":operation", "delete"], CHARSET], label: `delete row ${node} of ${sheetPath}` };
}

/** The first free row node name, in the order the field CLI used: `row`, `row0`, `row1`, … */
export function nextRowNode(existing: readonly string[]): string {
  if (!existing.includes("row")) {
    return "row";
  }
  for (let i = 0; ; i += 1) {
    if (!existing.includes(`row${i}`)) {
      return `row${i}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Replication
// ---------------------------------------------------------------------------

export type ReplicationAgent = "preview" | "publish";

/** Field-proven shape: parameters in the query string, empty body; `type=preview` selects the preview agent. */
export function buildReplicate(scope: WriteScope, path: string, command: "Activate" | "Deactivate", agent: ReplicationAgent): PlannedRequest {
  assertWritable(path, scope.roots);
  const params = new URLSearchParams({ cmd: command, path });
  if (agent === "preview") {
    params.set("type", "preview");
  }
  return { method: "POST", path: `/bin/replicate?${params.toString()}`, form: [], label: `${command === "Activate" ? "publish" : "unpublish"} ${path} (${agent})` };
}

// ---------------------------------------------------------------------------
// Page lifecycle (wcmcommand)
// ---------------------------------------------------------------------------

export function buildCreatePage(scope: WriteScope, input: { readonly parentPath: string; readonly name: string; readonly title: string; readonly template: string }): PlannedRequest {
  assertWritable(input.parentPath, scope.roots);
  assertSegment(input.name, "page name");
  assertAemPath(input.template);
  if (!/^\/(?:conf|libs|apps)\//.test(input.template)) {
    throw new InvalidOperationError(`"${input.template}" is not a template path under /conf, /libs or /apps.`);
  }
  return {
    method: "POST",
    path: WCM_COMMAND,
    form: [["cmd", "createPage"], CHARSET, ["parentPath", input.parentPath], ["label", input.name], ["title", input.title], ["template", input.template]],
    label: `create ${input.parentPath}/${input.name}`,
  };
}

export function buildCopyPage(scope: WriteScope, input: { readonly srcPath: string; readonly destParentPath: string; readonly destName: string; readonly shallow: boolean }): PlannedRequest {
  assertWritable(input.srcPath, scope.roots);
  assertWritable(input.destParentPath, scope.roots);
  assertSegment(input.destName, "page name");
  return {
    method: "POST",
    path: WCM_COMMAND,
    form: [
      ["cmd", "copyPage"],
      CHARSET,
      ["srcPath", input.srcPath],
      ["destParentPath", input.destParentPath],
      ["destName", input.destName],
      ["shallow", String(input.shallow)],
    ],
    label: `copy ${input.srcPath} to ${input.destParentPath}/${input.destName}`,
  };
}

export function buildMovePage(scope: WriteScope, input: { readonly srcPath: string; readonly destParentPath: string; readonly destName: string }): PlannedRequest {
  assertWritable(input.srcPath, scope.roots);
  assertWritable(input.destParentPath, scope.roots);
  assertSegment(input.destName, "page name");
  if (`${input.destParentPath}/`.startsWith(`${input.srcPath}/`)) {
    throw new InvalidOperationError(`Cannot move ${input.srcPath} into itself.`);
  }
  return {
    method: "POST",
    path: WCM_COMMAND,
    form: [["cmd", "movePage"], CHARSET, ["srcPath", input.srcPath], ["destParentPath", input.destParentPath], ["destName", input.destName], ["integrity", "true"]],
    label: `move ${input.srcPath} to ${input.destParentPath}/${input.destName}`,
  };
}

export function buildDeletePage(scope: WriteScope, path: string): PlannedRequest {
  assertWritable(path, scope.roots);
  if (scope.roots.includes(path)) {
    throw new InvalidOperationError(`${path} is a write root; deleting a whole root is not offered.`);
  }
  return { method: "POST", path: WCM_COMMAND, form: [["cmd", "deletePage"], CHARSET, ["path", path], ["force", "false"]], label: `delete ${path}` };
}

// ---------------------------------------------------------------------------
// MSM and locks (aem-sites-msm exploration.md: the Sites console's own requests)
// ---------------------------------------------------------------------------

export interface CreateLiveCopyInput {
  /** Any readable page: the source need not be inside the write roots, only the copy. */
  readonly srcPath: string;
  readonly destParentPath: string;
  readonly name: string;
  readonly title: string;
  readonly rolloutConfigs: readonly string[];
  /** Exclude sub-pages of the source. */
  readonly shallow: boolean;
}

export function buildCreateLiveCopy(scope: WriteScope, input: CreateLiveCopyInput): PlannedRequest {
  assertReadable(input.srcPath);
  assertWritable(input.destParentPath, scope.roots);
  assertSegment(input.name, "page name");
  if (input.rolloutConfigs.length === 0) {
    throw new InvalidOperationError("A Live Copy needs at least one rollout config.");
  }
  const configs = [...new Set(input.rolloutConfigs)].map((config) => assertRolloutConfig(config, scope.extraRolloutConfigs ?? []));
  const dest = `${input.destParentPath}/${input.name}`;
  if (`${dest}/`.startsWith(`${input.srcPath}/`) || `${input.srcPath}/`.startsWith(`${dest}/`)) {
    throw new InvalidOperationError(`A Live Copy cannot be created inside its own source, or above it (${input.srcPath} → ${dest}).`);
  }
  return {
    method: "POST",
    path: WCM_COMMAND,
    form: [
      ["cmd", "createLiveCopy"],
      ["operation", "asyncCreateLiveCopy"],
      CHARSET,
      ["srcPath", input.srcPath],
      ["destPath", input.destParentPath],
      ["label", input.name],
      ["title", input.title],
      ["shallow", String(input.shallow)],
      ...configs.map((config) => ["cq:rolloutConfigs", config] as const),
    ],
    label: `create the Live Copy ${dest} of ${input.srcPath}`,
  };
}

export function buildLockPage(scope: WriteScope, path: string, lock: boolean): PlannedRequest {
  assertWritable(path, scope.roots);
  return {
    method: "POST",
    path: WCM_COMMAND,
    form: [["cmd", lock ? "lockPage" : "unlockPage"], CHARSET, ["path", path]],
    label: `${lock ? "lock" : "unlock"} ${path}`,
  };
}
