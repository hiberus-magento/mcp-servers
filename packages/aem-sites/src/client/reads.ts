// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Read operations (aem-sites-package design.md, D3). QueryBuilder is never
// exposed raw: each read builds its own predicates from typed input, and
// every response is projected field by field — a property the author adds
// never reaches a caller, because nothing here spreads a parsed object.
import { assertAemPath } from "../guard/paths.js";
import type { AuthorHttp } from "./http.js";

const QUERY_BUILDER = "/bin/querybuilder.json";
const MAX_QUERY_LIMIT = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function strList(source: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = source[key];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return typeof value === "string" ? [value] : undefined;
}

function present<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
  return value !== undefined ? ({ [key]: value } as { [P in K]: V }) : {};
}

function query(params: Record<string, string>): string {
  return `${QUERY_BUILDER}?${new URLSearchParams(params).toString()}`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export interface QueryPagesOptions {
  readonly root: string;
  readonly limit?: number;
  readonly offset?: number;
  /** Only the root's direct children instead of the whole subtree. */
  readonly childrenOnly?: boolean;
}

export interface PageHit {
  readonly path: string;
  readonly title?: string;
  readonly lastModified?: string;
}

export interface PageList {
  readonly root: string;
  readonly total: number;
  readonly offset: number;
  readonly more: boolean;
  readonly pages: readonly PageHit[];
}

export async function queryPages(http: AuthorHttp, options: QueryPagesOptions): Promise<PageList> {
  const root = assertAemPath(options.root);
  const limit = Math.min(Math.max(options.limit ?? 100, 1), MAX_QUERY_LIMIT);
  const offset = Math.max(options.offset ?? 0, 0);
  const params: Record<string, string> = {
    path: root,
    "path.self": "true",
    type: "cq:Page",
    orderby: "path",
    "p.limit": String(limit),
    "p.offset": String(offset),
    "p.guessTotal": "false",
  };
  if (options.childrenOnly === true) {
    params["path.flat"] = "true";
    delete params["path.self"];
  }
  const { body } = await http.readJson({ method: "GET", path: query(params), label: `the pages under ${root}` });
  const source = isRecord(body) ? body : {};
  const hits = Array.isArray(source.hits) ? source.hits.filter(isRecord) : [];
  const pages = hits
    .map((hit): PageHit | undefined => {
      const path = str(hit, "path");
      return path === undefined ? undefined : { path, ...present("title", str(hit, "title")), ...present("lastModified", str(hit, "lastModified")) };
    })
    .filter((hit): hit is PageHit => hit !== undefined);
  const total = typeof source.total === "number" ? source.total : pages.length;
  return { root, total, offset, more: source.more === true || offset + pages.length < total, pages };
}

/** The page properties a caller may see. Everything else on `jcr:content` stays on the author. */
const PAGE_FIELDS = [
  "jcr:title",
  "jcr:description",
  "pageTitle",
  "navTitle",
  "cq:canonicalUrl",
  "sling:alias",
  "cq:redirectTarget",
  "cq:template",
  "cq:lastModified",
  "cq:lastModifiedBy",
  "jcr:lockOwner",
] as const;
const PAGE_LIST_FIELDS = ["cq:robotsTags", "cq:tags"] as const;

export interface ReplicationState {
  readonly lastAction?: string;
  readonly lastReplicated?: string;
  readonly lastReplicatedBy?: string;
}

export interface PageReplication {
  readonly publish: ReplicationState;
  readonly preview: ReplicationState;
}

export interface PageDetails {
  readonly path: string;
  readonly properties: Readonly<Record<string, string | boolean | readonly string[]>>;
  readonly replication: PageReplication;
}

function replicationState(content: Record<string, unknown>, suffix: string): ReplicationState {
  return {
    ...present("lastAction", str(content, `cq:lastReplicationAction${suffix}`)),
    ...present("lastReplicated", str(content, `cq:lastReplicated${suffix}`)),
    ...present("lastReplicatedBy", str(content, `cq:lastReplicatedBy${suffix}`)),
  };
}

/** `extra` names `AEM_EXTRA_PROPERTIES`: a project's own page properties are readable once declared. */
export function projectPage(path: string, content: Record<string, unknown>, extra: readonly string[]): PageDetails {
  const properties: Record<string, string | boolean | readonly string[]> = {};
  for (const field of [...PAGE_FIELDS, ...extra]) {
    const value = content[field];
    if (typeof value === "string" || typeof value === "boolean") {
      properties[field] = value;
    } else if (typeof value === "number") {
      properties[field] = String(value);
    } else if (Array.isArray(value)) {
      properties[field] = value.filter((entry): entry is string => typeof entry === "string");
    }
  }
  for (const field of PAGE_LIST_FIELDS) {
    const value = strList(content, field);
    if (value !== undefined) {
      properties[field] = value;
    }
  }
  const hide = content.hideInNav;
  if (hide === true || hide === "true") {
    properties.hideInNav = true;
  }
  return { path, properties, replication: { publish: replicationState(content, ""), preview: replicationState(content, "_preview") } };
}

/** `undefined` when there is no page at `path`. */
export async function readPage(http: AuthorHttp, path: string, extra: readonly string[] = []): Promise<PageDetails | undefined> {
  assertAemPath(path);
  const { status, body } = await http.readJson({ method: "GET", path: `${path}/jcr:content.json`, label: `the page ${path}`, expectedStatuses: [404] });
  if (status === 404 || !isRecord(body) || body["jcr:primaryType"] !== "cq:PageContent") {
    return undefined;
  }
  return projectPage(path, body, extra);
}

/** Paths at or below `root` whose publish or preview state is "activated". Bounded to 100 hits. */
export async function queryPublishedPages(http: AuthorHttp, root: string): Promise<readonly string[]> {
  assertAemPath(root);
  const params = {
    path: root,
    "path.self": "true",
    type: "cq:Page",
    "group.p.or": "true",
    "group.1_property": "jcr:content/cq:lastReplicationAction",
    "group.1_property.value": "Activate",
    "group.2_property": "jcr:content/cq:lastReplicationAction_preview",
    "group.2_property.value": "Activate",
    "p.limit": "100",
  };
  const { body } = await http.readJson({ method: "GET", path: query(params), label: `the published pages under ${root}` });
  const hits = isRecord(body) && Array.isArray(body.hits) ? body.hits.filter(isRecord) : [];
  return hits.map((hit) => str(hit, "path")).filter((path): path is string => path !== undefined);
}

// ---------------------------------------------------------------------------
// Sheets (the EDS bulk `metadata` sheet and any other sheet page)
// ---------------------------------------------------------------------------

export interface SheetRow {
  /** The row node's name (`row`, `row0`, …) — generated by the client on write, never taken from input. */
  readonly node: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface Sheet {
  readonly path: string;
  readonly columns: readonly string[];
  readonly rows: readonly SheetRow[];
}

/** Projection of a sheet's `jcr:content.1.json`: the declared columns and, per row node, only those columns. */
export function projectSheet(path: string, content: Record<string, unknown>): Sheet {
  const columns = strList(content, "columns") ?? [];
  const rows: SheetRow[] = [];
  for (const [node, value] of Object.entries(content)) {
    if (!isRecord(value) || value["jcr:primaryType"] !== "nt:unstructured") {
      continue;
    }
    const values: Record<string, string> = {};
    for (const column of columns) {
      const cell = value[column];
      if (typeof cell === "string") {
        values[column] = cell;
      }
    }
    rows.push({ node, values });
  }
  return { path, columns, rows };
}

/** `undefined` when there is no sheet page at `path`. */
export async function readSheet(http: AuthorHttp, path: string): Promise<Sheet | undefined> {
  assertAemPath(path);
  const { status, body } = await http.readJson({ method: "GET", path: `${path}/jcr:content.1.json`, label: `the sheet ${path}`, expectedStatuses: [404] });
  if (status === 404 || !isRecord(body)) {
    return undefined;
  }
  return projectSheet(path, body);
}

// ---------------------------------------------------------------------------
// Templates and component trees
// ---------------------------------------------------------------------------

export interface TemplateHit {
  readonly path: string;
  readonly title?: string;
}

export async function listTemplates(http: AuthorHttp, confRoot: string): Promise<readonly TemplateHit[]> {
  if (!/^\/conf(?:\/[A-Za-z0-9_-]+)*$/.test(confRoot)) {
    throw new Error(`"${confRoot}" is not a /conf path.`);
  }
  const { body } = await http.readJson({
    method: "GET",
    path: query({ path: confRoot, type: "cq:Template", orderby: "path", "p.limit": String(MAX_QUERY_LIMIT) }),
    label: `the templates under ${confRoot}`,
  });
  const hits = isRecord(body) && Array.isArray(body.hits) ? body.hits.filter(isRecord) : [];
  return hits
    .map((hit): TemplateHit | undefined => {
      const path = str(hit, "path");
      return path === undefined ? undefined : { path, ...present("title", str(hit, "title")) };
    })
    .filter((hit): hit is TemplateHit => hit !== undefined);
}

export interface ComponentNode {
  readonly name: string;
  readonly resourceType?: string;
  readonly properties: Readonly<Record<string, string | number | boolean | readonly string[]>>;
  readonly children: readonly ComponentNode[];
}

/**
 * Content properties are what a caller asks a page tree for, so they cannot
 * be a fixed allowlist the way page properties are. What is excluded instead
 * is everything that is not authored content: access control, bookkeeping,
 * locks and Sling internals. Values are scalars or string lists only.
 */
const TREE_EXCLUDED_PREFIXES = ["rep:", "jcr:created", "jcr:lastModified", "jcr:lock", "jcr:uuid", "jcr:mixinTypes", "cq:last", "oak:", "sling:resourceSuperType"] as const;

function projectNode(name: string, node: Record<string, unknown>): ComponentNode {
  const properties: Record<string, string | number | boolean | readonly string[]> = {};
  const children: ComponentNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (TREE_EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix)) || key === "jcr:primaryType" || key === "sling:resourceType") {
      continue;
    }
    if (isRecord(value)) {
      children.push(projectNode(key, value));
    } else if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      properties[key] = value;
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      properties[key] = value as string[];
    }
  }
  return { name, ...present("resourceType", str(node, "sling:resourceType")), properties, children };
}

export async function readPageTree(http: AuthorHttp, path: string, depth: number): Promise<ComponentNode | undefined> {
  assertAemPath(path);
  const bounded = Math.min(Math.max(Math.trunc(depth), 1), 4);
  const { status, body } = await http.readJson({
    method: "GET",
    path: `${path}/jcr:content.${bounded}.json`,
    label: `the component tree of ${path}`,
    expectedStatuses: [404],
  });
  if (status === 404 || !isRecord(body)) {
    return undefined;
  }
  return projectNode("jcr:content", body);
}

// ---------------------------------------------------------------------------
// Auth probe (the field CLI's `eds aem auth status`)
// ---------------------------------------------------------------------------

export async function probeAuth(http: AuthorHttp, root: string): Promise<{ readonly status: number }> {
  const { status } = await http.readJson({ method: "GET", path: query({ path: root, type: "cq:Page", "p.limit": "1" }), label: "the QueryBuilder probe" });
  return { status };
}
