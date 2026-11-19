// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Input fragments shared by many tools. Bounds live here once: a per-tool copy of a cap is a
// per-tool chance to forget it. Nothing here ever reaches a document as text — values travel
// as GraphQL variables — so these bounds are about cost and sanity, not about escaping.
import { z } from "zod";

/** A SKU. Magento caps it at 64 characters. */
export const sku = z.string().min(1).max(64).describe("The SKU (Stock Keeping Unit) of the product.");

export const pageSize = (max = 50, fallback = 10) => z.number().int().min(1).max(max).optional().describe(`Results per page, 1 to ${max} (default ${fallback}).`);

export const currentPage = z.number().int().min(1).optional().describe("Page number, starting at 1 (default 1).");

export const store = z
  .string()
  .regex(/^[a-z0-9_]{1,32}$/, "a store view code: lower-case letters, digits and underscore (max 32)")
  .optional()
  .describe("Store view code to read as (the `Store` header), e.g. default. Defaults to MAGENTO_GRAPHQL_STORE, then to the store's default view.");

export const currency = z
  .string()
  .regex(/^[A-Z]{3}$/, "a three-letter ISO 4217 code in upper case")
  .optional()
  .describe("Currency to price in (the `Content-Currency` header), e.g. EUR. Must be one the store view allows.");

/** The `store` and `currency` arguments every storefront read can take. */
export const context = { store, currency } as const;

/** A masked cart id, as `createGuestCart` returns it. */
export const cartId = z
  .string()
  .regex(/^[A-Za-z0-9]{1,64}$/, "a masked cart id: letters and digits only")
  .describe("The masked cart ID (from magentographql_create_guest_cart or magentographql_get_customer_cart).");

/** A GraphQL `uid`: base64 text. */
export const uid = (what: string) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/=_-]{1,128}$/, "a uid: base64 text")
    .describe(`The uid of the ${what} (an opaque base64 string, not the numeric ID).`);

/** The context arguments as a call context, for `ToolSpec.context`. */
export const contextOf = (args: { readonly store?: string | undefined; readonly currency?: string | undefined }) => ({ store: args.store, currency: args.currency });
