// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Product media tools: two reads and three writes, ported from the original
// `src/tools/media.js`. `add_product_image` uploads bytes that pass through the
// model, and the original bounded none of it. Here:
//
//   - the data is base64 only (`[A-Za-z0-9+/]` with up to two `=`), at most
//     2,000,000 characters — about 1.5 MB of image, which is already far more
//     than should travel through a model's context;
//   - the MIME type is one of jpeg, png, gif or webp;
//   - the file name is a plain name with an image extension and no path, so it
//     cannot place a file anywhere but where Magento puts it;
//   - the image roles are the four Magento defines.
//
// `update_product_media` reads the entry first and sends its `media_type` back: a live
// 2.4.8 answers a PUT without it 400 ("There is no MediaGalleryEntryConverter for given
// type"), so the original's update could never have worked.
//
// Magento still validates the bytes as an image; this only keeps the request
// from being the thing that is unbounded. The image data is never echoed in an
// error (errors keep Magento's message template only).
import { z } from "zod";
import { restPath } from "../client/index.js";
import { entityId, sku } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";

const IMAGE_ROLES = ["image", "small_image", "thumbnail", "swatch_image"] as const;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const MAX_BASE64_CHARS = 2_000_000;

const entryId = entityId("media entry");
const label = z.string().min(1).max(255);
const position = z.number().int().min(0);
const roles = z.array(z.enum(IMAGE_ROLES)).max(IMAGE_ROLES.length);

function readField(record: unknown, key: string): unknown {
  return record !== null && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
}
const readText = (record: unknown, key: string): string | undefined => {
  const value = readField(record, key);
  return typeof value === "string" ? value : undefined;
};
const readNumber = (record: unknown, key: string): number | undefined => {
  const value = readField(record, key);
  return typeof value === "number" ? value : undefined;
};
const readBool = (record: unknown, key: string): boolean | undefined => {
  const value = readField(record, key);
  return typeof value === "boolean" ? value : undefined;
};
const readStrings = (record: unknown, key: string): string[] | undefined => {
  const value = readField(record, key);
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : undefined;
};

export function mediaTools({ readTool, writeTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_product_media",
      description: "Use this to list a product's media entries (images and videos): ID, type, label, position, whether hidden, the roles it plays and its file path.",
      input: z.object({ sku }).strict(),
      shape: shapes.media_entry,
      run: async ({ sku }, client) => {
        const entries = await client.get(restPath`/products/${sku}/media`);
        return Array.isArray(entries) ? entries : [];
      },
    }),

    readTool({
      name: "magentorest_get_product_media_entry",
      description: "Use this to read one media entry of a product by its entry ID.",
      input: z.object({ sku, entry_id: entryId }).strict(),
      shape: shapes.media_entry,
      run: ({ sku, entry_id }, client) => client.get(restPath`/products/${sku}/media/${entry_id}`),
    }),

    writeTool({
      name: "magentorest_add_product_image",
      description:
        "Use this to add an image to a product from base64 data (at most 2,000,000 characters, JPEG, PNG, GIF or WebP). Adds a media entry; it does not remove existing ones. Returns the new entry ID.",
      effect: "create",
      input: z
        .object({
          sku,
          image_base64: z
            .string()
            .min(1)
            .max(MAX_BASE64_CHARS)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/, "base64 only")
            .describe("Base64-encoded image data."),
          image_type: z.enum(IMAGE_TYPES).optional().describe("MIME type (default image/jpeg)."),
          image_name: z
            .string()
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,98}\.(?:jpe?g|png|gif|webp)$/i, "a plain file name ending in .jpg, .jpeg, .png, .gif or .webp, with no path")
            .describe("File name, e.g. product-front.jpg."),
          label: label.optional().describe("Alt text (default: the file name)."),
          position: position.optional().describe("Sort position (default 0)."),
          types: roles.optional().describe("Roles: image, small_image, thumbnail, swatch_image."),
          disabled: z.boolean().optional().describe("Hide the image (default false)."),
        })
        .strict(),
      shape: [],
      run: ({ sku, image_base64, image_type, image_name, label, position, types, disabled }, client) =>
        client.post(restPath`/products/${sku}/media`, {
          entry: {
            media_type: "image",
            label: label ?? image_name,
            position: position ?? 0,
            disabled: disabled === true,
            types: types ?? [],
            content: { base64_encoded_data: image_base64, type: image_type ?? "image/jpeg", name: image_name },
          },
        }),
    }),

    writeTool({
      name: "magentorest_update_product_media",
      description: "Use this to change a media entry's label, position, roles or hidden flag. Only the fields you pass change; at least one is required. Overwrites the current values.",
      effect: "update",
      input: z
        .object({
          sku,
          entry_id: entryId,
          label: label.optional().describe("New label (alt text)."),
          position: position.optional().describe("New sort position."),
          types: roles.optional().describe("New roles."),
          disabled: z.boolean().optional().describe("Whether the image is hidden."),
        })
        .strict(),
      shape: [],
      run: async ({ sku, entry_id, label, position, types, disabled }, client) => {
        if (label === undefined && position === undefined && types === undefined && disabled === undefined) {
          throw new Error("magentorest_update_product_media: nothing to update — pass at least one field besides the SKU and entry ID.");
        }
        // Magento chooses its converter by `media_type`, so a PUT without it is answered 400
        // ("There is no MediaGalleryEntryConverter for given type") — which is why the original's
        // update never worked. The entry is read, and its own type and fields go back with the
        // changes applied; an explicit `false` or `[]` is a real value, not "keep the old one".
        const existing = await client.get(restPath`/products/${sku}/media/${entry_id}`);
        return client.put(restPath`/products/${sku}/media/${entry_id}`, {
          entry: {
            id: entry_id,
            media_type: readText(existing, "media_type") ?? "image",
            label: label ?? readText(existing, "label"),
            position: position ?? readNumber(existing, "position"),
            disabled: disabled ?? readBool(existing, "disabled"),
            types: types ?? readStrings(existing, "types"),
            file: readText(existing, "file"),
          },
        });
      },
    }),

    writeTool({
      name: "magentorest_delete_product_media",
      description: "Use this to permanently delete one media entry of a product. Irreversible: the image stops showing on the storefront.",
      effect: "delete",
      input: z.object({ sku, entry_id: entryId }).strict(),
      shape: [],
      run: ({ sku, entry_id }, client) => client.delete(restPath`/products/${sku}/media/${entry_id}`),
    }),
  ];
}
