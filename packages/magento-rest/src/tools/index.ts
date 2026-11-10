// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The assembled `magentorest_*` surface, and the ONE place the write switch
// is enforced. With the switch off (the default) a write tool is not merely
// refused at call time — it is never registered, so it does not appear in
// `tools/list` and an agent cannot be talked into calling something it was
// never shown. The decision is made once, at startup: a server that started
// read-only cannot be switched into writing by anything a client sends.
//
// Tools are also grouped (`GROUPS`), so an operator who needs only some of them
// can load only those (`MAGENTO_REST_GROUPS`) instead of the whole surface.
//
// Pure like the module files: no side effects on import, so unit tests can
// import it and `mcp.ts` is the only file that also connects a transport.
import type { DatabaseAccess } from "../db/access.js";
import { analyticsTools } from "./analytics-tools.js";
import { attributeTools } from "./attributes-tools.js";
import { cartTools } from "./carts-tools.js";
import { categoryTools } from "./categories-tools.js";
import { cmsTools } from "./cms-tools.js";
import { customerTools } from "./customers-tools.js";
import { databaseTools } from "./database-tools.js";
import { applyFieldConfig, type FieldConfig } from "./field-config.js";
import { createToolFactory, type MagentoRestTool, type ToolFactory } from "./rest-tool.js";
import { productTools } from "./products-tools.js";
import { promotionTools } from "./promotions-tools.js";
import { mediaTools } from "./media-tools.js";
import { orderTools } from "./orders-tools.js";
import type { MagentoRestRuntime } from "./runtime.js";
import { BASE_SHAPES, type ShapeSet } from "./shapes.js";
import { salesDocumentTools } from "./sales-documents-tools.js";
import { stockTools } from "./stock-tools.js";
import { storeTools } from "./store-tools.js";
import { taxTools } from "./tax-tools.js";

export type { MagentoRestTool } from "./rest-tool.js";

export interface CreateToolsOptions {
  /** Called per tool call, never while assembling, so `tools/list` works before the base URL is set. */
  readonly getRuntime: () => MagentoRestRuntime;
  readonly writesEnabled: boolean;
  /** Fields the operator added to the shipped allowlists (`field-config.ts`); none by default. */
  readonly fieldConfig?: FieldConfig;
  /** Groups to load (`GROUP_NAMES`); none or empty loads every group. An unknown name throws. */
  readonly groups?: readonly string[];
  /**
   * The database session, when `MAGENTO_REST_DATABASE_CONNECTION` is set. It is what makes the `database` group
   * exist at all; its own `writesEnabled` (not `writesEnabled` above) decides whether `db_execute` is registered.
   */
  readonly database?: DatabaseAccess;
}

/**
 * One group per module file: the unit an operator can switch on. Each tool belongs to exactly one, so the
 * groups partition the surface and choosing all of them is the same as choosing none.
 */
const GROUPS = {
  products: productTools,
  store: storeTools,
  categories: categoryTools,
  customers: customerTools,
  orders: orderTools,
  "sales-documents": salesDocumentTools,
  stock: stockTools,
  carts: cartTools,
  cms: cmsTools,
  attributes: attributeTools,
  media: mediaTools,
  promotions: promotionTools,
  tax: taxTools,
  analytics: analyticsTools,
} as const satisfies Record<string, (factory: ToolFactory) => readonly MagentoRestTool[]>;

type GroupName = keyof typeof GROUPS;

/** The groups that run over the REST API. */
const REST_GROUP_NAMES = Object.keys(GROUPS) as readonly GroupName[];

const DATABASE_GROUP = "database";

/** Every group an operator can name: the REST ones, and `database` (which also needs a database connection). */
export const GROUP_NAMES: readonly string[] = [...REST_GROUP_NAMES, DATABASE_GROUP];

const isGroupName = (name: string): name is GroupName => Object.hasOwn(GROUPS, name);

function assertKnownGroups(groups: readonly string[]): readonly string[] {
  const unknown = groups.filter((name) => !isGroupName(name) && name !== DATABASE_GROUP);
  if (unknown.length > 0) {
    throw new Error(`Unknown tool group${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Valid groups: ${GROUP_NAMES.join(", ")}.`);
  }
  return groups;
}

/**
 * The value of `MAGENTO_REST_GROUPS`: comma-separated, case-insensitive, blanks and repeats ignored. Unset or
 * blank means no selection (every group). A name that is not a group throws rather than being skipped:
 * a typo must not silently leave a tool set out.
 */
export function parseGroups(value: string | undefined): readonly string[] {
  const names = [...new Set((value ?? "").split(",").map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0))];
  assertKnownGroups(names);
  return names;
}

export function assertUniqueNames(tools: readonly MagentoRestTool[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name registered: ${tool.name}`);
    }
    seen.add(tool.name);
  }
}

function assemble(getRuntime: () => MagentoRestRuntime, shapes: ShapeSet, groups: readonly GroupName[] = REST_GROUP_NAMES): readonly MagentoRestTool[] {
  const factory = createToolFactory(() => getRuntime().client, { shapes });
  const tools = groups.flatMap((group) => GROUPS[group](factory));
  assertUniqueNames(tools);
  return tools;
}

export function createMagentoRestTools(options: CreateToolsOptions): readonly MagentoRestTool[] {
  const chosen = assertKnownGroups(options.groups ?? []);
  if (chosen.includes(DATABASE_GROUP) && options.database === undefined) {
    throw new Error("The database group needs a database: set MAGENTO_REST_DATABASE_CONNECTION (and its password), or leave `database` out of MAGENTO_REST_GROUPS.");
  }
  const restGroups = (chosen.length > 0 ? chosen : REST_GROUP_NAMES).filter(isGroupName);
  const rest = assemble(options.getRuntime, applyFieldConfig(BASE_SHAPES, options.fieldConfig ?? {}), restGroups);
  const restTools = options.writesEnabled ? rest : rest.filter((tool) => tool.access === "read");

  // The database tools follow their OWN write switch: letting the REST API change orders is not letting SQL change rows.
  const database = options.database;
  const wantsDatabase = database !== undefined && (chosen.length === 0 || chosen.includes(DATABASE_GROUP));
  const dbTools = wantsDatabase ? databaseTools(database).filter((tool) => tool.access === "read" || database.writesEnabled) : [];

  const tools = [...restTools, ...dbTools];
  assertUniqueNames(tools);
  return tools;
}

/** Every tool, writes included — for tests and the manifest check, never for a running server. */
export function allMagentoRestTools(): readonly MagentoRestTool[] {
  const unavailable = (): never => {
    throw new Error("allMagentoRestTools is for inspection; it has no runtime to call");
  };
  const rest = assemble(unavailable, BASE_SHAPES);
  const database = databaseTools({ writesEnabled: true, read: unavailable, write: unavailable });
  const tools = [...rest, ...database];
  assertUniqueNames(tools);
  return tools;
}
