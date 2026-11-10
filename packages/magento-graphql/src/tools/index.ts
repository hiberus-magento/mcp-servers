// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The assembled `magentographql_*` surface, and the ONE place the write switch is enforced. With
// the switch off (the default) a write tool is not merely refused at call time — it is never
// registered, so it does not appear in `tools/list` and an agent cannot be talked into calling
// something it was never shown. The decision is made once, at startup.
//
// Tools are also grouped, so an operator who needs only some can load only those
// (`MAGENTO_GRAPHQL_GROUPS`). Pure like the module files: no side effects on import.
import { cartTools } from "./cart-tools.js";
import { categoryTools } from "./categories-tools.js";
import { cmsTools } from "./cms-tools.js";
import { customerTools } from "./customer-tools.js";
import { GENERATED_GROUP_NAMES, generatedTools } from "./generated-tools.js";
import { createToolFactory, type MagentoGraphqlTool, type ToolFactory } from "./graphql-tool.js";
import { productTools } from "./products-tools.js";
import { queryTools } from "./query-tools.js";
import type { MagentoGraphqlRuntime } from "./runtime.js";
import { storeTools } from "./store-tools.js";

export type { MagentoGraphqlTool } from "./graphql-tool.js";

export interface CreateToolsOptions {
  /** Called per tool call, never while assembling, so `tools/list` works before the base URL is set. */
  readonly getRuntime: () => MagentoGraphqlRuntime;
  readonly writesEnabled: boolean;
  /** Groups to load (`GROUP_NAMES`); none or empty loads every group. An unknown name throws. */
  readonly groups?: readonly string[];
}

/**
 * One group per area: the unit an operator can switch on. Each tool belongs to exactly one. The hand-written
 * tools come first, and the operations generated from the schema (`generated/schema-tools.ts`) are added to the
 * group they were assigned to, so `products` holds both the curated search and the generated review tools.
 */
const HAND_WRITTEN: Record<string, (factory: ToolFactory) => readonly MagentoGraphqlTool[]> = {
  products: productTools,
  categories: categoryTools,
  cms: cmsTools,
  store: storeTools,
  customer: customerTools,
  cart: cartTools,
  query: queryTools,
};

const GROUPS: Readonly<Record<string, (factory: ToolFactory) => readonly MagentoGraphqlTool[]>> = Object.fromEntries(
  [...new Set([...Object.keys(HAND_WRITTEN), ...GENERATED_GROUP_NAMES])].map((group) => {
    const own = HAND_WRITTEN[group];
    const generated = GENERATED_GROUP_NAMES.includes(group) ? generatedTools(group) : undefined;
    return [group, (factory: ToolFactory) => [...(own?.(factory) ?? []), ...(generated?.(factory) ?? [])]] as const;
  }),
);

type GroupName = string;

export const GROUP_NAMES: readonly string[] = Object.keys(GROUPS);

const isGroupName = (name: string): boolean => Object.hasOwn(GROUPS, name);

function assertKnownGroups(groups: readonly string[]): readonly GroupName[] {
  const unknown = groups.filter((name) => !isGroupName(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown tool group${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Valid groups: ${GROUP_NAMES.join(", ")}.`);
  }
  return groups;
}

/** The value of `MAGENTO_GRAPHQL_GROUPS`: comma-separated, case-insensitive, blanks and repeats ignored. A typo throws rather than leaving a tool out. */
export function parseGroups(value: string | undefined): readonly string[] {
  const names = [...new Set((value ?? "").split(",").map((name) => name.trim().toLowerCase()).filter((name) => name.length > 0))];
  assertKnownGroups(names);
  return names;
}

export function assertUniqueNames(tools: readonly MagentoGraphqlTool[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name registered: ${tool.name}`);
    }
    seen.add(tool.name);
  }
}

function assemble(getRuntime: () => MagentoGraphqlRuntime, groups: readonly GroupName[]): readonly MagentoGraphqlTool[] {
  const factory = createToolFactory(() => getRuntime().client);
  const tools = groups.flatMap((group) => (GROUPS[group] as (factory: ToolFactory) => readonly MagentoGraphqlTool[])(factory));
  assertUniqueNames(tools);
  return tools;
}

export function createMagentoGraphqlTools(options: CreateToolsOptions): readonly MagentoGraphqlTool[] {
  const chosen = assertKnownGroups(options.groups ?? []);
  const tools = assemble(options.getRuntime, chosen.length > 0 ? chosen : GROUP_NAMES);
  return options.writesEnabled ? tools : tools.filter((tool) => tool.access === "read");
}

/** Every tool, writes included — for tests and the manifest check, never for a running server. */
export function allMagentoGraphqlTools(): readonly MagentoGraphqlTool[] {
  return assemble(() => {
    throw new Error("allMagentoGraphqlTools is for inspection; it has no runtime to call");
  }, Object.keys(GROUPS) as GroupName[]);
}
