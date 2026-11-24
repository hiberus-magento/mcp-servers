// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Typed conditions for the cart price rule writes and read (Kora phase B; feature doc
// odd/tasks/magento-rest-sales-rule-conditions.md). A caller never writes Magento's condition classes: it picks one
// of a closed list of kinds, and this module builds and reads the trees. What Magento does (2.4-develop source):
//
//   - A rule carries two ConditionInterface trees over REST: `condition`, which decides whether the cart qualifies,
//     and `action_condition`, which decides which items the discount applies to. Each node has condition_type (a PHP
//     class), conditions (its children), aggregator_type, operator, attribute_name and value.
//   - A tree sent in a PUT replaces the stored one whole (Converter\ToModel: setConditions([])->loadArray), and a
//     root with no children clears it. A tree that is not sent is kept.
//   - Cart attributes (Rule\Condition\Address): base_subtotal and total_qty are numeric (>= and <= offered here);
//     country_id is a select, whose operators are only == and !=, so "one of several countries" is not offered.
//   - A product condition on the cart sits under a Product\Found combine: value 1 means an item matching it is in the
//     cart, 0 that no item matches it. category_ids and sku take () "is one of" and !() "is not one of", their value
//     a comma-separated list (Magento splits it on , and ;, so a SKU cannot contain either).
//
// Every set is one level of ALL-true conditions under its root. A stored tree outside that list (built in the admin)
// is read as unsupported rather than guessed at, so a caller never writes back a set it was shown only in part.
import { z } from "zod";

const NS = "Magento\\SalesRule\\Model\\Rule\\Condition\\";
const COMBINE = `${NS}Combine`;
const ADDRESS = `${NS}Address`;
const FOUND = `${NS}Product\\Found`;
const PRODUCT = `${NS}Product`;
const PRODUCT_COMBINE = `${NS}Product\\Combine`;

/** A list caps a condition set; Magento has none, and a promotion needs few. */
export const MAX_CONDITIONS = 20;
const MAX_LIST = 100;

const amount = z.number().min(0).max(100_000_000).describe("Amount in the website's base currency.");
const qty = z.number().int().min(0).max(1_000_000).describe("Number of items.");
const country = z.string().regex(/^[A-Z]{2}$/, "a two-letter ISO country code in capitals, such as ES").describe("Two-letter ISO country code, such as ES.");
const categoryIds = z.array(z.number().int().min(1)).min(1).max(MAX_LIST).describe("Category ids.");
const skus = z
  .array(z.string().regex(/^[^,;\s][^,;]{0,62}[^,;\s]$|^[^,;\s]$/, "a SKU without commas, semicolons or surrounding spaces (max 64)"))
  .min(1)
  .max(MAX_LIST)
  .describe("Product SKUs.");

const kind = <T extends string, S extends z.ZodRawShape>(type: T, shape: S, what: string) => z.object({ type: z.literal(type), ...shape }).strict().describe(what);

export const cartConditionSchema = z.discriminatedUnion("type", [
  kind("subtotal_at_least", { amount }, "The cart subtotal (base currency, before discounts) is at least amount."),
  kind("subtotal_at_most", { amount }, "The cart subtotal (base currency, before discounts) is at most amount."),
  kind("total_qty_at_least", { qty }, "The cart holds at least qty items in total."),
  kind("total_qty_at_most", { qty }, "The cart holds at most qty items in total."),
  kind("shipping_country_is", { country }, "The shipping address is in country."),
  kind("shipping_country_is_not", { country }, "The shipping address is not in country."),
  kind("cart_has_product_in_categories", { category_ids: categoryIds }, "At least one item in the cart is in one of category_ids."),
  kind("cart_has_no_product_in_categories", { category_ids: categoryIds }, "No item in the cart is in any of category_ids."),
  kind("cart_has_sku", { skus }, "At least one item in the cart has one of skus."),
]);

export const itemConditionSchema = z.discriminatedUnion("type", [
  kind("category_in", { category_ids: categoryIds }, "The item is in one of category_ids."),
  kind("category_not_in", { category_ids: categoryIds }, "The item is in none of category_ids."),
  kind("sku_in", { skus }, "The item has one of skus."),
]);

export type CartCondition = z.infer<typeof cartConditionSchema>;
export type ItemCondition = z.infer<typeof itemConditionSchema>;
type AnyCondition = CartCondition | ItemCondition;

export const cartConditionsSchema = z
  .array(cartConditionSchema)
  .max(MAX_CONDITIONS)
  .describe(
    `Conditions the cart must meet for the rule to apply, all of them (at most ${MAX_CONDITIONS}). An empty list means every cart qualifies. ` +
      "On an update, the list replaces the rule's whole set.",
  );
export const itemConditionsSchema = z
  .array(itemConditionSchema)
  .max(MAX_CONDITIONS)
  .describe(
    `Conditions an item must meet for the discount to apply to it, all of them (at most ${MAX_CONDITIONS}). An empty list means every item. ` +
      "On an update, the list replaces the rule's whole set.",
  );

export const FREE_SHIPPING = ["none", "matching_items", "whole_cart"] as const;
export type FreeShipping = (typeof FREE_SHIPPING)[number];
export const freeShippingSchema = z
  .enum(FREE_SHIPPING)
  .describe("Free shipping the rule grants: none, matching_items (only the items the discount applies to), or whole_cart (the whole shipment, once an item matches).");
/** Magento stores the choice as 0, 1 (Rule::FREE_SHIPPING_ITEM) or 2 (Rule::FREE_SHIPPING_ADDRESS) and passes it raw. */
const FREE_SHIPPING_VALUE: Readonly<Record<FreeShipping, string>> = { none: "0", matching_items: "1", whole_cart: "2" };

export const freeShippingValue = (choice: FreeShipping): string => FREE_SHIPPING_VALUE[choice];

/** The stored value as a choice; none when unset, undefined when Magento holds a value outside the three. */
export function freeShippingOf(stored: unknown): FreeShipping | undefined {
  if (stored === null || stored === undefined || stored === "") return "none";
  return FREE_SHIPPING.find((choice) => FREE_SHIPPING_VALUE[choice] === String(stored));
}

/** The id or SKU listed twice in one condition, if any. */
export function duplicateIn(list: readonly AnyCondition[]): string | undefined {
  for (const condition of list) {
    const values: readonly (string | number)[] = "category_ids" in condition ? condition.category_ids : "skus" in condition ? condition.skus : [];
    const seen = new Set<string | number>();
    for (const value of values) {
      if (seen.has(value)) return `${condition.type} lists ${JSON.stringify(value)} more than once.`;
      seen.add(value);
    }
  }
  return undefined;
}

// ---- To Magento ----------------------------------------------------------------------------------------------

interface Node {
  readonly condition_type: string;
  readonly aggregator_type?: string;
  readonly value: string;
  readonly attribute_name?: string;
  readonly operator?: string;
  readonly conditions?: readonly Node[];
}

const leaf = (type: string, attribute: string, operator: string, value: string): Node => ({ condition_type: type, attribute_name: attribute, operator, value });
const allOf = (type: string, value: "1" | "0", conditions: readonly Node[]): Node => ({ condition_type: type, aggregator_type: "all", value, conditions });
const listValue = (values: readonly (string | number)[]): string => values.join(",");
/** Category ids written in ascending order, so a set reads back the same however it was given. */
const idsValue = (ids: readonly number[]): string => listValue([...ids].sort((a, b) => a - b));

function cartNode(condition: CartCondition): Node {
  switch (condition.type) {
    case "subtotal_at_least":
      return leaf(ADDRESS, "base_subtotal", ">=", String(condition.amount));
    case "subtotal_at_most":
      return leaf(ADDRESS, "base_subtotal", "<=", String(condition.amount));
    case "total_qty_at_least":
      return leaf(ADDRESS, "total_qty", ">=", String(condition.qty));
    case "total_qty_at_most":
      return leaf(ADDRESS, "total_qty", "<=", String(condition.qty));
    case "shipping_country_is":
      return leaf(ADDRESS, "country_id", "==", condition.country);
    case "shipping_country_is_not":
      return leaf(ADDRESS, "country_id", "!=", condition.country);
    case "cart_has_product_in_categories":
      return allOf(FOUND, "1", [leaf(PRODUCT, "category_ids", "()", idsValue(condition.category_ids))]);
    case "cart_has_no_product_in_categories":
      return allOf(FOUND, "0", [leaf(PRODUCT, "category_ids", "()", idsValue(condition.category_ids))]);
    case "cart_has_sku":
      return allOf(FOUND, "1", [leaf(PRODUCT, "sku", "()", listValue(condition.skus))]);
  }
}

function itemNode(condition: ItemCondition): Node {
  switch (condition.type) {
    case "category_in":
      return leaf(PRODUCT, "category_ids", "()", idsValue(condition.category_ids));
    case "category_not_in":
      return leaf(PRODUCT, "category_ids", "!()", idsValue(condition.category_ids));
    case "sku_in":
      return leaf(PRODUCT, "sku", "()", listValue(condition.skus));
  }
}

/** The rule's `condition` tree for these cart conditions (a root with no children for an empty list). */
export const cartTree = (list: readonly CartCondition[]): Node => allOf(COMBINE, "1", list.map(cartNode));
/** The rule's `action_condition` tree for these item conditions. */
export const itemTree = (list: readonly ItemCondition[]): Node => allOf(PRODUCT_COMBINE, "1", list.map(itemNode));

// ---- From Magento --------------------------------------------------------------------------------------------

const record = (value: unknown): Record<string, unknown> | undefined => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

/** Magento returns a combine's value as "1", 1 or true. */
const isTrue = (value: unknown): boolean => value === true || value === 1 || value === "1";
const isFalse = (value: unknown): boolean => value === false || value === 0 || value === "0";

const children = (node: Record<string, unknown>): unknown[] | undefined => {
  const list = node["conditions"];
  if (list === undefined || list === null) return [];
  return Array.isArray(list) ? list : undefined;
};

/** A node that only an extension attribute would change the meaning of (2.4.7+ attribute_scope). */
const scoped = (node: Record<string, unknown>): boolean => {
  const scope = record(node["extension_attributes"])?.["attribute_scope"];
  return scope !== undefined && scope !== null && scope !== "";
};

/** An ALL-true root of this class; undefined when the node is anything else. */
function rootChildren(tree: unknown, type: string): unknown[] | undefined {
  const node = record(tree);
  if (node === undefined) return undefined;
  if (node["condition_type"] !== type || node["aggregator_type"] !== "all" || !isTrue(node["value"])) return undefined;
  return children(node);
}

const number = (value: unknown): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !/^\s*\d+(\.\d+)?\s*$/.test(value)) return undefined;
  return Number(value);
};

const listOf = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) return value.every((v) => typeof v === "string" || typeof v === "number") ? value.map((v) => String(v).trim()).filter((v) => v !== "") : undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return String(value)
    .split(/\s*[,;]\s*/)
    .map((v) => v.trim())
    .filter((v) => v !== "");
};

const idsOf = (value: unknown): number[] | undefined => {
  const list = listOf(value);
  if (list === undefined || list.length === 0 || !list.every((v) => /^[1-9]\d*$/.test(v))) return undefined;
  return list.map(Number);
};

const skusOf = (value: unknown): string[] | undefined => {
  const list = listOf(value);
  return list === undefined || list.length === 0 ? undefined : list;
};

/** A product leaf as an item condition; undefined when it is anything else. */
function productLeaf(tree: unknown): ItemCondition | undefined {
  const node = record(tree);
  if (node === undefined || node["condition_type"] !== PRODUCT || scoped(node) || (children(node)?.length ?? 1) > 0) return undefined;
  const { attribute_name: attribute, operator, value } = node;
  if (attribute === "category_ids") {
    const ids = idsOf(value);
    if (ids === undefined) return undefined;
    if (operator === "()") return { type: "category_in", category_ids: ids };
    if (operator === "!()") return { type: "category_not_in", category_ids: ids };
  }
  if (attribute === "sku" && operator === "()") {
    const list = skusOf(value);
    if (list !== undefined) return { type: "sku_in", skus: list };
  }
  return undefined;
}

function cartCondition(tree: unknown): CartCondition | undefined {
  const node = record(tree);
  if (node === undefined) return undefined;
  const { condition_type: type, attribute_name: attribute, operator, value } = node;
  if (type === ADDRESS) {
    if ((children(node)?.length ?? 1) > 0) return undefined;
    if (attribute === "base_subtotal" || attribute === "total_qty") {
      const n = number(value);
      if (n === undefined || (attribute === "total_qty" && !Number.isInteger(n))) return undefined;
      if (operator === ">=") return attribute === "base_subtotal" ? { type: "subtotal_at_least", amount: n } : { type: "total_qty_at_least", qty: n };
      if (operator === "<=") return attribute === "base_subtotal" ? { type: "subtotal_at_most", amount: n } : { type: "total_qty_at_most", qty: n };
    }
    if (attribute === "country_id" && typeof value === "string" && /^[A-Z]{2}$/.test(value)) {
      if (operator === "==") return { type: "shipping_country_is", country: value };
      if (operator === "!=") return { type: "shipping_country_is_not", country: value };
    }
    return undefined;
  }
  if (type === FOUND && node["aggregator_type"] === "all") {
    const inner = children(node);
    if (inner?.length !== 1) return undefined;
    const product = productLeaf(inner[0]);
    if (product === undefined) return undefined;
    if (isTrue(value) && product.type === "category_in") return { type: "cart_has_product_in_categories", category_ids: product.category_ids };
    if (isFalse(value) && product.type === "category_in") return { type: "cart_has_no_product_in_categories", category_ids: product.category_ids };
    if (isTrue(value) && product.type === "sku_in") return { type: "cart_has_sku", skus: product.skus };
  }
  return undefined;
}

function readTree<T>(tree: unknown, rootType: string, read: (node: unknown) => T | undefined): T[] | undefined {
  // No tree, or an empty one: nothing set.
  if (tree === null || tree === undefined) return [];
  const nodes = rootChildren(tree, rootType);
  if (nodes === undefined) return undefined;
  const out: T[] = [];
  for (const node of nodes) {
    const condition = read(node);
    if (condition === undefined) return undefined;
    out.push(condition);
  }
  return out;
}

/** The stored `condition` as cart conditions; undefined when it holds anything outside the list. */
export const readCartConditions = (tree: unknown): CartCondition[] | undefined => readTree(tree, COMBINE, cartCondition);
/** The stored `action_condition` as item conditions; undefined when it holds anything outside the list. */
export const readItemConditions = (tree: unknown): ItemCondition[] | undefined => readTree(tree, PRODUCT_COMBINE, productLeaf);

/** One condition in a form that ignores the order of its ids and SKUs. */
const canonical = (condition: AnyCondition): string => {
  const sorted = (values: readonly (string | number)[]) => [...values].map(String).sort();
  if ("category_ids" in condition) return JSON.stringify([condition.type, sorted(condition.category_ids)]);
  if ("skus" in condition) return JSON.stringify([condition.type, sorted(condition.skus)]);
  return JSON.stringify(condition);
};

/** Two condition sets that apply the same way: the same conditions, in any order (all must hold). */
export function sameConditions(a: readonly AnyCondition[], b: readonly AnyCondition[]): boolean {
  return a.length === b.length && JSON.stringify(a.map(canonical).sort()) === JSON.stringify(b.map(canonical).sort());
}
