// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// CMS tools: four reads and six writes over blocks and pages, ported from the
// original `src/tools/cms.js`. These writes put HTML into a live storefront,
// so beyond the usual encoded paths, validated criteria and bounded pages:
//
//   - an identifier is a closed shape (letters, digits, `_`, `-`, `.`, `/`,
//     starting alphanumeric, at most 100), never free text;
//   - content is capped at 200,000 characters;
//   - there is NO store-ID argument. The original sent `store_id` on create, and a
//     live Magento 2.4.8 answers 400 ("%fieldName" is not supported, fieldName
//     StoreId): the REST body for a block or a page takes no store assignment, so
//     the original's create never worked there. Without it Magento creates the
//     record for all store views;
//   - the searches return summaries WITHOUT `content` (an HTML body can be very
//     large, and the original filtered only on identifier and title anyway);
//     `get_*_by_id` returns the content;
//   - `update_*` reads the record first, as the original did, but an explicit
//     empty identifier or title is rejected by the schema instead of meaning
//     "keep the old one" (the original's `||`). An explicit empty CONTENT is
//     allowed and clears it, as it did there.
//
// The updates send only the identifying fields and the ones that changed,
// matching the original. Magento's resource layer writes only the fields it is
// given, so the rest of the record is left alone — but that is behaviour of
// Magento's model layer, not something checked against a live store, and every
// tool here says so.
import { z } from "zod";
import { restPath, type SearchFilter } from "../client/index.js";
import { currentPage, entityId, pageSize } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";
import { listOf, type ResourceName } from "./shapes.js";

const LIST_PAGE_SIZE = 20;
const PAGE_LAYOUTS = ["1column", "2columns-left", "2columns-right", "3columns", "empty"] as const;

const identifier = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,99}$/, "letters, digits, _ - . and / only, starting with a letter or digit (max 100)")
  .describe("Identifier (for a page, its URL key).");

const title = z.string().min(1).max(255).describe("Title.");
const content = z.string().max(200_000).describe("Content (HTML), up to 200,000 characters.");
const isActive = z.boolean().describe("Whether it is active.");

function readString(record: unknown, key: string): string | undefined {
  if (record !== null && typeof record === "object" && key in record) {
    const value = (record as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function readBoolean(record: unknown, key: string): boolean | undefined {
  if (record !== null && typeof record === "object" && key in record) {
    const value = (record as Record<string, unknown>)[key];
    return typeof value === "boolean" ? value : undefined;
  }
  return undefined;
}

interface Kind {
  readonly name: "block" | "page";
  /** The REST resource segment: `cmsBlock` or `cmsPage`. */
  readonly resource: "cmsBlock" | "cmsPage";
  readonly idKey: "block_id" | "page_id";
  readonly shape: ResourceName;
  readonly summary: ResourceName;
}

const BLOCK: Kind = { name: "block", resource: "cmsBlock", idKey: "block_id", shape: "cms_block", summary: "cms_block_summary" };
const PAGE: Kind = { name: "page", resource: "cmsPage", idKey: "page_id", shape: "cms_page", summary: "cms_page_summary" };

export function cmsTools({ readTool, writeTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  const idInput = (kind: Kind) => z.object({ [kind.idKey]: entityId(`CMS ${kind.name}`) }).strict();
  const idOf = (kind: Kind, args: Record<string, unknown>): number => args[kind.idKey] as number;

  /** The tools that are the same for a block and a page. */
  const shared = (kind: Kind): readonly MagentoRestTool[] => [
    readTool({
      name: `magentorest_get_cms_${kind.name}_by_id`,
      description: `Use this to read one CMS ${kind.name} by ID, including its content (HTML), title, identifier, dates and whether it is active.`,
      input: idInput(kind),
      shape: shapes[kind.shape],
      run: (args, client) => client.get(restPath`/${kind.resource}/${idOf(kind, args)}`),
    }),

    readTool({
      name: `magentorest_search_cms_${kind.name}s`,
      description: `Use this to find CMS ${kind.name}s by identifier (exact), part of the title, or active status. Filters are combined with AND. Returns a bounded page of summaries WITHOUT the content, and the total count; read one by ID for its content.`,
      input: z
        .object({
          identifier: identifier.optional(),
          title: z.string().min(1).max(200).optional().describe("Text the title must contain."),
          is_active: isActive.optional(),
          page_size: pageSize,
          current_page: currentPage,
        })
        .strict(),
      shape: listOf(shapes[kind.summary]),
      run: async (args, client) => {
        // One filter per group: groups are AND'd, which is what these mean.
        const filters: SearchFilter[] = [];
        if (args.identifier !== undefined) filters.push({ field: "identifier", value: args.identifier });
        if (args.title !== undefined) filters.push({ field: "title", value: `%${args.title}%`, conditionType: "like" });
        if (args.is_active !== undefined) filters.push({ field: "is_active", value: args.is_active ? 1 : 0 });
        const result = await client.search(`/${kind.resource}/search`, {
          filterGroups: filters.map((filter) => [filter]),
          pageSize: args.page_size ?? LIST_PAGE_SIZE,
          currentPage: args.current_page ?? 1,
        });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    writeTool({
      name: `magentorest_update_cms_${kind.name}`,
      description: `Use this to change a CMS ${kind.name}'s identifier, title, content or active flag. Only the fields you pass change; at least one is required. Overwrites the current values on the live storefront.`,
      effect: "update",
      input: z
        .object({
          [kind.idKey]: entityId(`CMS ${kind.name} to update`),
          identifier: identifier.optional(),
          title: title.optional(),
          content: content.optional(),
          is_active: isActive.optional(),
        })
        .strict(),
      shape: shapes[kind.shape],
      run: async (args, client) => {
        const id = idOf(kind, args);
        if (args.identifier === undefined && args.title === undefined && args.content === undefined && args.is_active === undefined) {
          throw new Error(`magentorest_update_cms_${kind.name}: nothing to update — pass at least one field besides the ${kind.idKey.replace("_", " ")}.`);
        }
        const existing = await client.get(restPath`/${kind.resource}/${id}`);
        return client.put(restPath`/${kind.resource}/${id}`, {
          [kind.name]: {
            id,
            identifier: args.identifier ?? readString(existing, "identifier"),
            title: args.title ?? readString(existing, "title"),
            // An explicit empty string is a real value: it clears the content.
            content: args.content !== undefined ? args.content : readString(existing, "content"),
            active: args.is_active ?? readBoolean(existing, "active"),
          },
        });
      },
    }),

    writeTool({
      name: `magentorest_delete_cms_${kind.name}`,
      description: `Use this to permanently delete a CMS ${kind.name} by ID. Irreversible: it disappears from the storefront immediately.`,
      effect: "delete",
      input: idInput(kind),
      shape: [],
      run: (args, client) => client.delete(restPath`/${kind.resource}/${idOf(kind, args)}`),
    }),
  ];

  return [
    ...shared(BLOCK),
    ...shared(PAGE),

    writeTool({
      name: "magentorest_create_cms_block",
      description: "Use this to create a CMS block. Adds a block for all store views (Magento's REST body takes no store assignment) that is active unless you say otherwise.",
      effect: "create",
      input: z.object({ identifier, title, content, is_active: isActive.optional() }).strict(),
      shape: shapes.cms_block,
      run: (args, client) =>
        client.post("/cmsBlock", {
          block: { identifier: args.identifier, title: args.title, content: args.content, active: args.is_active ?? true },
        }),
    }),

    writeTool({
      name: "magentorest_create_cms_page",
      description: "Use this to create a CMS page at a URL key. Adds a page for all store views (Magento's REST body takes no store assignment) that is active, with a one-column layout, unless you say otherwise.",
      effect: "create",
      input: z
        .object({
          identifier,
          title,
          content,
          content_heading: z.string().min(1).max(255).optional().describe("Heading shown above the content."),
          page_layout: z.enum(PAGE_LAYOUTS).optional().describe("Layout (default 1column)."),
          meta_title: z.string().min(1).max(255).optional().describe("SEO meta title."),
          meta_keywords: z.string().min(1).max(255).optional().describe("SEO meta keywords."),
          meta_description: z.string().min(1).max(1000).optional().describe("SEO meta description."),
          is_active: isActive.optional(),
        })
        .strict(),
      shape: shapes.cms_page,
      run: (args, client) =>
        client.post("/cmsPage", {
          page: {
            identifier: args.identifier,
            title: args.title,
            content: args.content,
            page_layout: args.page_layout ?? "1column",
            active: args.is_active ?? true,
            ...(args.content_heading !== undefined ? { content_heading: args.content_heading } : {}),
            ...(args.meta_title !== undefined ? { meta_title: args.meta_title } : {}),
            ...(args.meta_keywords !== undefined ? { meta_keywords: args.meta_keywords } : {}),
            ...(args.meta_description !== undefined ? { meta_description: args.meta_description } : {}),
          },
        }),
    }),
  ];
}
