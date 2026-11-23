// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Product content as one store view sees it, and a write of only what changes (Kora contract R-20..R-24).
//
// The READ returns the five content fields (name, description, short_description, meta_title, meta_description)
// and each image's label as the store view sees them: its own value, or the inherited one, or null when there is
// none. Magento's GET in a store view already resolves that (the store's row, else the default), and leaves an
// attribute with no value out of `custom_attributes`, which is reported as null. An unknown SKU is a result,
// `found: false`, not an error.
//
// The WRITE goes through Magento's standard REST API, which has no attribute-only update, so it is careful:
//   - store_view is checked first: absent, empty, `all` or `admin` is refused without a call (a global write
//     changes every language and market);
//   - lengths are checked before any call, because Magento does not check them (it truncates);
//   - the product is read first, so an unknown SKU is `not_found` and never created by the PUT, and an image id
//     the product does not have is `not_found` on that image;
//   - only the members whose value differs from what was read are sent: a product PUT with the SKU and the changed
//     name or attributes, and per changed label the full media entry (Magento replaces an entry whole);
//   - the content is read again and returned, so a repeat call finds nothing to change and sends nothing.
//
// KNOWN SIDE EFFECT, accepted and documented: any product save in a store view makes Magento write a store-view
// row (label, position, hidden) for EVERY image of the product, copied from its current values. What the store
// shows does not change, but those images stop inheriting later changes made to the default values for that store
// view. Magento 2.4.6 also pins at store-view level a sent value that equals the inherited one, so content writes
// need Magento 2.4.7 or later; the server cannot read the patch version, so this is stated, not checked.
import { z } from "zod";
import { MagentoRestError, restPath, type MagentoRestClient } from "../client/index.js";
import { provenanceSchema, type Provenance } from "./output-schema.js";
import { provenanceOf, type MagentoRestTool, type ToolFactory } from "./rest-tool.js";
import { ToolArgumentError } from "./tool-error.js";
import { sku } from "./inputs.js";

export const PRODUCT_CONTENT_READ_TOOL = "magentorest_get_product_content";
export const PRODUCT_CONTENT_WRITE_TOOL = "magentorest_update_product_content";

const CONTENT_FIELDS = ["name", "description", "short_description", "meta_title", "meta_description"] as const;
type ContentField = (typeof CONTENT_FIELDS)[number];

/** Magento's own limits for these attributes (varchar(255) counts characters; text counts bytes). */
const MAX_CHARS: Partial<Record<ContentField, number>> = { name: 255, meta_title: 255, meta_description: 255 };
const MAX_TEXT_BYTES = 65_535;
const MAX_LABEL_CHARS = 255;

const STORE_VIEW = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const GLOBAL_SCOPES: ReadonlySet<string> = new Set(["all", "admin"]);
const UNKNOWN_ROUTE = "Request does not match any route";

const contentSchema = z.object(Object.fromEntries(CONTENT_FIELDS.map((field) => [field, z.string().nullable()])) as Record<ContentField, z.ZodNullable<z.ZodString>>);
const imageSchema = z.object({ id: z.string(), file: z.string().nullable(), label: z.string().nullable() });

/** R-20's shape. `content` and `images` are absent when `found` is false. */
const productContentSchema = z.object({
  found: z.boolean(),
  sku: z.string(),
  store_view: z.string(),
  content: contentSchema.optional(),
  images: z.array(imageSchema).optional(),
  provenance: provenanceSchema,
});

type ProductContent = z.infer<typeof productContentSchema>;

interface MediaEntry {
  readonly id: number;
  readonly label: string | null;
  readonly file: string | null;
  readonly raw: Record<string, unknown>;
}

interface ReadProduct {
  readonly content: Record<ContentField, string | null>;
  readonly media: readonly MediaEntry[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function parseProduct(body: unknown): ReadProduct {
  const record = isRecord(body) ? body : {};
  const custom = new Map<string, unknown>();
  for (const attribute of Array.isArray(record["custom_attributes"]) ? record["custom_attributes"] : []) {
    if (isRecord(attribute) && typeof attribute["attribute_code"] === "string") custom.set(attribute["attribute_code"], attribute["value"]);
  }
  const content = Object.fromEntries(CONTENT_FIELDS.map((field) => [field, text(field === "name" ? record["name"] : custom.get(field))])) as Record<ContentField, string | null>;
  const media: MediaEntry[] = [];
  for (const entry of Array.isArray(record["media_gallery_entries"]) ? record["media_gallery_entries"] : []) {
    if (isRecord(entry) && typeof entry["id"] === "number") media.push({ id: entry["id"], label: text(entry["label"]), file: text(entry["file"]), raw: entry });
  }
  return { content, media };
}

function shaped(skuValue: string, storeView: string, product: ReadProduct, provenance: Provenance): ProductContent {
  return {
    found: true,
    sku: skuValue,
    store_view: storeView,
    content: product.content,
    images: product.media.map((entry) => ({ id: String(entry.id), file: entry.file, label: entry.label })),
    provenance,
  };
}

/** The store view a call addresses, checked before anything is sent. A write also refuses the global scopes. */
function checkedStoreView(value: string | undefined, forWrite: boolean): string {
  if (value === undefined || value === "") {
    throw new ToolArgumentError("invalid_argument", "store_view", "store_view is required: the code of the store view to read or write (for example default).");
  }
  if (!STORE_VIEW.test(value)) {
    throw new ToolArgumentError("invalid_argument", "store_view", "store_view must be a store view code: letters, digits and underscores.");
  }
  if (forWrite && GLOBAL_SCOPES.has(value.toLowerCase())) {
    throw new ToolArgumentError("invalid_argument", "store_view", "Content is written to one store view only: all and admin are the global scope, which would change every language and market.");
  }
  return value;
}

/** An unknown store view is answered by Magento as a route that does not exist. */
const isUnknownStoreView = (error: unknown): boolean => error instanceof MagentoRestError && error.kind === "not-found" && error.message.includes(UNKNOWN_ROUTE);
const isMissingProduct = (error: unknown): boolean => error instanceof MagentoRestError && error.kind === "not-found" && !error.message.includes(UNKNOWN_ROUTE);

async function readProduct(client: MagentoRestClient, skuValue: string): Promise<ReadProduct> {
  try {
    return parseProduct(await client.get(restPath`/products/${skuValue}`));
  } catch (error) {
    if (isUnknownStoreView(error)) throw new ToolArgumentError("invalid_argument", "store_view", "Magento has no store view with that code.");
    throw error;
  }
}

const storeViewInput = z.string().optional().describe("The store view code (for example default). Required; checked by the tool.");
const contentInput = z
  .object(Object.fromEntries(CONTENT_FIELDS.map((field) => [field, z.string().optional()])) as Record<ContentField, z.ZodOptional<z.ZodString>>)
  .strict()
  .optional()
  .describe("The content fields to set, each optional: name, description, short_description, meta_title, meta_description.");
const imagesInput = z
  .array(z.object({ id: z.string().describe("The media entry id, as a string (for example \"12\")."), label: z.string().describe("The new label (alt text).") }).strict())
  .max(100)
  .optional()
  .describe("Image labels to set, by media entry id.");

interface CheckedChange {
  readonly content: { readonly [K in ContentField]?: string | undefined };
  readonly images: readonly { readonly id: number; readonly label: string }[];
}

/** Every given value, checked against Magento's limits before anything is sent. */
function checkedChange(content: { readonly [K in ContentField]?: string | undefined } | undefined, images: readonly { id: string; label: string }[] | undefined): CheckedChange {
  for (const field of CONTENT_FIELDS) {
    const value = content?.[field];
    if (value === undefined) continue;
    const argument = `content.${field}`;
    if (field === "name" && value === "") throw new ToolArgumentError("invalid_argument", argument, "A product name cannot be empty.");
    const maxChars = MAX_CHARS[field];
    if (maxChars !== undefined && [...value].length > maxChars) throw new ToolArgumentError("invalid_argument", argument, `${field} is at most ${maxChars} characters.`);
    if (maxChars === undefined && Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) throw new ToolArgumentError("invalid_argument", argument, `${field} is at most ${MAX_TEXT_BYTES} bytes.`);
  }
  const checkedImages = (images ?? []).map((image, index) => {
    if (!/^[1-9][0-9]{0,9}$/.test(image.id)) throw new ToolArgumentError("invalid_argument", `images[${index}].id`, "An image id is the media entry id as a decimal string, for example \"12\".");
    if (image.label === "") throw new ToolArgumentError("invalid_argument", `images[${index}].label`, "A label cannot be empty: Magento stores an empty label as no label.");
    if ([...image.label].length > MAX_LABEL_CHARS) throw new ToolArgumentError("invalid_argument", `images[${index}].label`, `A label is at most ${MAX_LABEL_CHARS} characters.`);
    return { id: Number(image.id), label: image.label };
  });
  return { content: content ?? {}, images: checkedImages };
}

export function productContentTools({ shapedTool }: ToolFactory): readonly MagentoRestTool[] {
  return [
    shapedTool({
      name: PRODUCT_CONTENT_READ_TOOL,
      description:
        "Use this to read a product's content as one store view shows it: name, description, short description, meta title and meta description, and each image's id, file and label. Each value is the store view's own or the one it inherits, null when there is none. An unknown SKU returns found: false.",
      input: z.object({ sku, store_view: storeViewInput }).strict(),
      output: productContentSchema,
      run: async ({ sku: skuValue, store_view }, track) => {
        const storeView = checkedStoreView(store_view, false);
        const read = track();
        try {
          const product = await readProduct(read.client.with({ scope: storeView }), skuValue);
          return shaped(skuValue, storeView, product, provenanceOf(read.answers));
        } catch (error) {
          if (isMissingProduct(error) && error instanceof MagentoRestError && error.answer !== undefined) {
            return { found: false, sku: skuValue, store_view: storeView, provenance: provenanceOf([error.answer]) };
          }
          throw error;
        }
      },
    }),

    shapedTool({
      name: PRODUCT_CONTENT_WRITE_TOOL,
      description:
        "Use this to change a product's content in ONE store view: any of name, description, short description, meta title and meta description, and image labels by id. Only the values that differ from the current ones are sent; the result is the content read back. A store view is required (all and admin are refused). " +
        "Requires Magento 2.4.7 or later. Side effect: Magento then writes a store-view value for every image of the product, so those images stop inheriting later changes made to the default values in this store view.",
      effect: "update",
      input: z.object({ sku, store_view: storeViewInput, content: contentInput, images: imagesInput }).strict(),
      output: productContentSchema,
      run: async ({ sku: skuValue, store_view, content, images }, track) => {
        const storeView = checkedStoreView(store_view, true);
        const change = checkedChange(content, images);

        const before = track();
        let current: ReadProduct;
        try {
          current = await readProduct(before.client.with({ scope: storeView }), skuValue);
        } catch (error) {
          if (isMissingProduct(error)) throw new ToolArgumentError("not_found", "sku", "No product with that SKU: nothing was written.");
          throw error;
        }
        const entries = change.images.map((image, index) => {
          const found = current.media.find((entry) => entry.id === image.id);
          if (found === undefined) throw new ToolArgumentError("not_found", `images[${index}].id`, "The product has no image with that id: nothing was written.");
          return { entry: found, label: image.label };
        });

        const scoped = before.client.with({ scope: storeView });
        const changedFields = CONTENT_FIELDS.filter((field) => change.content[field] !== undefined && change.content[field] !== current.content[field]);
        if (changedFields.length > 0) {
          const custom = changedFields.filter((field) => field !== "name").map((field) => ({ attribute_code: field, value: change.content[field] }));
          await scoped.put(restPath`/products/${skuValue}`, {
            product: { sku: skuValue, ...(changedFields.includes("name") ? { name: change.content.name } : {}), ...(custom.length > 0 ? { custom_attributes: custom } : {}) },
          });
        }
        for (const { entry, label } of entries) {
          if (label === entry.label) continue;
          await scoped.put(restPath`/products/${skuValue}/media/${entry.id}`, { entry: { ...entry.raw, label } });
        }

        const after = track();
        const product = await readProduct(after.client.with({ scope: storeView }), skuValue);
        return shaped(skuValue, storeView, product, provenanceOf(after.answers));
      },
    }),
  ];
}
