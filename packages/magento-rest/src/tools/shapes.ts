// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The named allowlists every read tool projects through (`project.ts`). A
// field that is not listed here cannot reach the model, whatever the Magento
// instance adds in its next release. Widening one is a reviewed change to
// this file, not a side effect of an upstream response growing a field.
import type { Shape } from "./project.js";

/** `{ items: [...], total_count }` — Magento's list envelope, around one item shape. */
export const listOf = (item: Shape): Shape => [["items", item], "total_count"];

/** A bounded multi-page walk (`getAllPages`) reports whether the cap cut it short. */
export const pagedListOf = (item: Shape): Shape => [["items", item], "total_count", "truncated"];

/**
 * The resources a field configuration may address. A resource is a KIND of
 * entity, not a tool: every tool that returns a product projects through
 * `product`, so widening it once widens it everywhere it appears.
 */
export const RESOURCE_NAMES = ["product", "product_summary", "store_config", "store_view", "website", "store_group", "country", "currency", "category", "category_tree_node", "customer", "customer_summary", "customer_address", "customer_group", "order", "order_summary", "order_item", "order_status_history", "invoice", "invoice_summary", "shipment", "shipment_summary", "shipment_track", "creditmemo", "creditmemo_summary", "stock_item", "inventory_source", "inventory_stock", "source_item", "cart", "cart_summary", "cart_item", "abandoned_cart", "cms_block", "cms_block_summary", "cms_page", "cms_page_summary", "product_attribute", "product_attribute_summary", "attribute_option", "attribute_set", "media_entry", "sales_rule", "coupon", "tax_rate", "tax_rule", "tax_class"] as const;

export type ResourceName = (typeof RESOURCE_NAMES)[number];

export type ShapeSet = Readonly<Record<ResourceName, Shape>>;

const ORDER_ITEM: Shape = [
  "item_id",
  "sku",
  "name",
  "qty_ordered",
  "qty_shipped",
  "qty_invoiced",
  "qty_refunded",
  "price",
  "row_total",
  "tax_amount",
  "discount_amount",
  "product_type",
];

const SHIPMENT_TRACK: Shape = ["entity_id", "parent_id", "order_id", "carrier_code", "title", "track_number", "created_at"];

const CART_ITEM: Shape = ["item_id", "quote_id", "sku", "name", "qty", "price", "product_type"];
const CART_CUSTOMER: Shape = ["id", "email", "firstname", "lastname", "group_id"];

/** The allowlists as shipped. `field-config.ts` can only ADD to these, never remove from them. */
export const BASE_SHAPES: ShapeSet = {
  product: [
    "id",
    "sku",
    "name",
    "price",
    "status",
    "visibility",
    "type_id",
    "attribute_set_id",
    "weight",
    "created_at",
    "updated_at",
    // Catalog attributes an admin entered (description, url_key, ...). An
    // attribute whose value is itself an object is dropped by `project`.
    ["custom_attributes", ["attribute_code", "value"]],
    // The original returned `extension_attributes` whole, which carries the
    // stock item and any module's additions; only the category links are kept.
    ["extension_attributes", [["category_links", ["category_id", "position"]]]],
  ],
  product_summary: ["id", "sku", "name", "price", "status", "type_id"],
  store_config: ["id", "code", "website_id", "locale", "base_currency_code", "default_display_currency_code", "timezone", "weight_unit", "base_url", "secure_base_url"],
  store_view: ["id", "code", "name", "website_id", "store_group_id", "is_active"],
  website: ["id", "code", "name", "default_group_id"],
  store_group: ["id", "website_id", "root_category_id", "default_store_id", "name", "code"],
  country: ["id", "two_letter_abbreviation", "three_letter_abbreviation", "full_name_locale", "full_name_english", ["available_regions", ["id", "code", "name"]]],
  category: [
    "id",
    "parent_id",
    "name",
    "is_active",
    "position",
    "level",
    "product_count",
    "children",
    "path",
    "include_in_menu",
    "available_sort_by",
    "created_at",
    "updated_at",
    ["custom_attributes", ["attribute_code", "value"]],
  ],
  // One node of the flattened category tree; `children_data` is dropped on purpose (see `flattenCategoryTree`).
  category_tree_node: ["id", "parent_id", "name", "is_active", "position", "level", "product_count"],
  // Customer records are personal data. The base list is the minimum that
  // identifies a customer to a human (id, name, email, group); date of birth,
  // tax number, gender and the address book are NOT in it. An operator who
  // needs them adds them in a reviewed `MAGENTO_REST_FIELDS_FILE`.
  customer: ["id", "group_id", "created_at", "updated_at", "email", "firstname", "lastname", "store_id", "website_id", "default_billing", "default_shipping"],
  customer_summary: ["id", "email", "firstname", "lastname", "group_id", "website_id", "created_at"],
  // An address WITHOUT street, telephone, company or the addressee's name by
  // default: where in the world, not who or where exactly. Add them in the file.
  customer_address: ["id", "customer_id", "country_id", "region_id", "city", "postcode", "default_billing", "default_shipping", ["region", ["region_code", "region"]]],
  customer_group: ["id", "code", "tax_class_id", "tax_class_name"],
  // An order WITHOUT its billing/shipping addresses and payment block. Totals,
  // state, the customer's identity as the order records it, and the lines are
  // here; addresses can be added in a reviewed MAGENTO_REST_FIELDS_FILE, and
  // payment can never be (the floor refuses it).
  order: [
    "entity_id",
    "increment_id",
    "status",
    "state",
    "customer_id",
    "customer_is_guest",
    "customer_email",
    "customer_firstname",
    "customer_lastname",
    "store_id",
    "store_name",
    "order_currency_code",
    "base_currency_code",
    "subtotal",
    "tax_amount",
    "discount_amount",
    "shipping_amount",
    "grand_total",
    "total_qty_ordered",
    "total_paid",
    "total_refunded",
    "shipping_description",
    "coupon_code",
    "created_at",
    "updated_at",
    ["items", ORDER_ITEM],
  ],
  order_summary: ["entity_id", "increment_id", "status", "state", "customer_email", "customer_firstname", "customer_lastname", "grand_total", "total_qty_ordered", "order_currency_code", "created_at", "updated_at"],
  order_item: ORDER_ITEM,
  order_status_history: ["entity_id", "parent_id", "status", "comment", "created_at", "is_customer_notified", "is_visible_on_front", "entity_name"],
  // Sales documents. Money, quantities and the lines — not the transaction id
  // (payment-adjacent) and not the addresses, only their IDs.
  invoice: [
    "entity_id",
    "order_id",
    "increment_id",
    "state",
    "grand_total",
    "subtotal",
    "tax_amount",
    "shipping_amount",
    "discount_amount",
    "total_qty",
    "order_currency_code",
    "created_at",
    "updated_at",
    ["items", ["entity_id", "order_item_id", "sku", "name", "qty", "price", "row_total", "tax_amount", "discount_amount"]],
  ],
  invoice_summary: ["entity_id", "order_id", "increment_id", "state", "grand_total", "order_currency_code", "created_at"],
  shipment: [
    "entity_id",
    "order_id",
    "increment_id",
    "total_qty",
    "total_weight",
    "created_at",
    "updated_at",
    ["items", ["entity_id", "order_item_id", "sku", "name", "qty", "weight"]],
    ["tracks", SHIPMENT_TRACK],
  ],
  shipment_summary: ["entity_id", "order_id", "increment_id", "total_qty", "created_at"],
  shipment_track: SHIPMENT_TRACK,
  creditmemo: [
    "entity_id",
    "order_id",
    "increment_id",
    "state",
    "grand_total",
    "subtotal",
    "tax_amount",
    "shipping_amount",
    "adjustment",
    "adjustment_positive",
    "adjustment_negative",
    "order_currency_code",
    "created_at",
    "updated_at",
    ["items", ["entity_id", "order_item_id", "sku", "name", "qty", "price", "row_total"]],
  ],
  creditmemo_summary: ["entity_id", "order_id", "increment_id", "state", "grand_total", "order_currency_code", "created_at"],
  // Stock. Quantities and rules, nothing about who holds them.
  stock_item: ["item_id", "product_id", "stock_id", "qty", "is_in_stock", "manage_stock", "min_qty", "min_sale_qty", "max_sale_qty", "backorders", "low_stock_date", "stock_status_changed_auto"],
  // A warehouse WITHOUT its street, phone, email or contact person.
  inventory_source: ["source_code", "name", "enabled", "description", "country_id", "region_id", "city", "postcode", "priority", "use_default_carrier_config"],
  inventory_stock: ["stock_id", "name", ["extension_attributes", [["sales_channels", ["type", "code"]]]]],
  source_item: ["sku", "source_code", "quantity", "status"],
  // Carts. The customer is identified (id, name, email, group) but the billing
  // and shipping addresses are not here.
  cart: [
    "id",
    "created_at",
    "updated_at",
    "is_active",
    "is_virtual",
    "items_count",
    "items_qty",
    "store_id",
    "customer_is_guest",
    ["customer", CART_CUSTOMER],
    ["currency", ["global_currency_code", "base_currency_code", "store_currency_code", "quote_currency_code"]],
    ["items", CART_ITEM],
  ],
  cart_summary: ["id", "created_at", "updated_at", "is_active", "items_count", "items_qty", ["customer", ["id", "email", "firstname", "lastname"]]],
  cart_item: CART_ITEM,
  abandoned_cart: ["cart_id", "customer_email", "customer_name", "items_count", "grand_total", "created_at", "updated_at"],
  // CMS. Content is what the page IS, so the by-ID reads return it; the
  // searches return summaries without it (an HTML body can be very large).
  // `layout_update_xml` and the custom layout fields are not here: they are
  // code-adjacent, not content.
  cms_block: ["id", "identifier", "title", "content", "creation_time", "update_time", "active"],
  cms_block_summary: ["id", "identifier", "title", "creation_time", "update_time", "active"],
  cms_page: ["id", "identifier", "title", "page_layout", "meta_title", "meta_keywords", "meta_description", "content_heading", "content", "creation_time", "update_time", "active", "sort_order"],
  cms_page_summary: ["id", "identifier", "title", "page_layout", "creation_time", "update_time", "active"],
  // Attribute definitions describe the CATALOG MODEL (code, input type, flags,
  // options), not catalog data about any person.
  product_attribute: [
    "attribute_id",
    "attribute_code",
    "frontend_input",
    "entity_type_id",
    "backend_type",
    "default_frontend_label",
    "scope",
    "is_required",
    "is_user_defined",
    "is_unique",
    "is_searchable",
    "is_filterable",
    "is_filterable_in_search",
    "is_comparable",
    "is_visible_on_front",
    "used_in_product_listing",
    "used_for_sort_by",
    "apply_to",
    ["options", ["label", "value"]],
    ["frontend_labels", ["store_id", "label"]],
  ],
  product_attribute_summary: ["attribute_id", "attribute_code", "frontend_input", "default_frontend_label", "is_required", "is_user_defined", "is_searchable", "is_filterable"],
  attribute_option: ["label", "value"],
  attribute_set: ["attribute_set_id", "attribute_set_name", "sort_order", "entity_type_id"],
  media_entry: ["id", "media_type", "label", "position", "disabled", "types", "file"],
  // Promotions. A coupon CODE is redeemable by anyone who holds it, which is why
  // the coupon tools exist (find a code, see its use) — and why they are admin
  // tools, not something to expose beyond the operator who configured them.
  sales_rule: [
    "rule_id",
    "name",
    "description",
    "from_date",
    "to_date",
    "is_active",
    "sort_order",
    "stop_rules_processing",
    "is_advanced",
    "simple_action",
    "discount_amount",
    "discount_qty",
    "discount_step",
    "apply_to_shipping",
    "times_used",
    "coupon_type",
    "use_auto_generation",
    "uses_per_customer",
    "uses_per_coupon",
    "simple_free_shipping",
    "website_ids",
    "customer_group_ids",
  ],
  coupon: ["coupon_id", "rule_id", "code", "usage_limit", "usage_per_customer", "times_used", "expiration_date", "is_primary", "created_at", "type"],
  tax_rate: ["id", "code", "rate", "tax_country_id", "tax_region_id", "tax_postcode", "zip_is_range", "zip_from", "zip_to"],
  tax_rule: ["id", "code", "priority", "position", "calculate_subtotal", "customer_tax_class_ids", "product_tax_class_ids", "tax_rate_ids"],
  tax_class: ["class_id", "class_name", "class_type"],
  currency: [
    "base_currency_code",
    "base_currency_symbol",
    "default_display_currency_code",
    "default_display_currency_symbol",
    "available_currency_codes",
    ["exchange_rates", ["currency_to", "rate"]],
  ],
};
