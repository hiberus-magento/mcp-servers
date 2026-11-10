// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { z } from "zod";
import type { MagentoGraphqlTool, ToolFactory } from "./graphql-tool.js";
import { context, contextOf } from "./inputs.js";

const PAGE = `
query GetCmsPage($identifier: String) {
  cmsPage(identifier: $identifier) {
    identifier
    url_key
    title
    page_layout
    content_heading
    content
    meta_title
    meta_description
    meta_keywords
  }
}`;

const BLOCKS = `
query GetCmsBlocks($identifiers: [String]) {
  cmsBlocks(identifiers: $identifiers) {
    items { identifier title content }
  }
}`;

const identifier = z.string().min(1).max(100);

export function cmsTools({ readTool }: ToolFactory): readonly MagentoGraphqlTool[] {
  return [
    readTool({
      name: "magentographql_get_cms_page",
      description: "Use this to read one enabled CMS page by its identifier, as the storefront serves it: title, layout, heading, HTML content and meta tags.",
      input: z.object({ identifier: identifier.describe("The page identifier (URL key), e.g. home or about-us."), ...context }).strict(),
      document: PAGE,
      pick: "cmsPage",
      variables: (a) => ({ identifier: a.identifier }),
      context: contextOf,
    }),
    readTool({
      name: "magentographql_get_cms_blocks",
      description: "Use this to read enabled CMS static blocks by identifier, as the storefront serves them: identifier, title and HTML content.",
      input: z.object({ identifiers: z.array(identifier).min(1).max(20).describe("Block identifiers, 1 to 20."), ...context }).strict(),
      document: BLOCKS,
      pick: "cmsBlocks",
      variables: (a) => ({ identifiers: a.identifiers }),
      // Magento answers a block that does not exist with a null entry (and an error message, which is kept).
      transform: (value) => ((value as { items?: unknown[] } | null)?.items ?? []).filter((item) => item !== null),
      context: contextOf,
    }),
  ];
}
