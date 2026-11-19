// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Input fragments shared by many tools. Bounds live here once: an unbounded
// `page_size` was one of the original's gaps, and a per-tool copy of the cap
// is a per-tool chance to forget it.
import { z } from "zod";
import { CONDITION_TYPES, FIELD_NAME_PATTERN } from "../client/index.js";

/** Magento caps a SKU at 64 characters. */
export const sku = z.string().min(1).max(64).describe("The SKU (Stock Keeping Unit) of the product.");

export const entityId = (what: string) => z.number().int().min(1).describe(`The numeric ID of the ${what}.`);

export const pageSize = z.number().int().min(1).max(100).optional().describe("Results per page, 1 to 100 (default 10).");

export const currentPage = z.number().int().min(1).optional().describe("Page number, starting at 1 (default 1).");

/** A Magento attribute or column code. Anything that could close a bracket or start a parameter is refused. */
export const fieldName = (what: string) =>
  z
    .string()
    .regex(FIELD_NAME_PATTERN, "letters, digits, underscore and dot only (max 64)")
    .describe(what);

export const conditionType = z.enum(CONDITION_TYPES).optional().describe("Comparison to apply (default eq).");

export const sortDirection = z.enum(["ASC", "DESC"]).optional().describe("Sort direction (default DESC).");

export const DEFAULT_SEARCH_PAGE_SIZE = 10;

/** A calendar date, `YYYY-MM-DD` — a closed shape, so it can never carry anything but a date into a filter value. */
export const isoDate = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
    .describe(what);
