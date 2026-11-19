// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The signed-in customer's own data. These need a CUSTOMER token (MAGENTO_GRAPHQL_TOKEN); without
// one Magento answers "The current customer isn't authorized." and the error says how to set it.
//
// Minimised on purpose: names, email and where an address is, but no street, phone, birth date,
// gender or tax id — an agent debugging a storefront does not need them, and the document is the
// allowlist (design D3).
import { z } from "zod";
import type { MagentoGraphqlTool, ToolFactory } from "./graphql-tool.js";
import { context, contextOf, currentPage, pageSize } from "./inputs.js";

const CART_ITEMS = `
  id
  total_quantity
  is_virtual
  itemsV2 {
    total_count
    items {
      uid
      quantity
      product { sku name }
      prices { price { value currency } row_total { value currency } }
    }
  }
  prices { grand_total { value currency } subtotal_excluding_tax { value currency } }
  applied_coupons { code }`;

const CUSTOMER = `
query GetCustomer {
  customer {
    firstname
    lastname
    email
    is_subscribed
    addresses { uid city region { region_code } postcode country_code default_shipping default_billing }
  }
}`;

const ORDERS = `
query GetCustomerOrders($filter: CustomerOrdersFilterInput, $pageSize: Int, $currentPage: Int) {
  customer {
    orders(filter: $filter, pageSize: $pageSize, currentPage: $currentPage) {
      total_count
      page_info { current_page page_size total_pages }
      items {
        number
        order_date
        status
        total { grand_total { value currency } }
        items { product_name product_sku quantity_ordered }
      }
    }
  }
}`;

const CUSTOMER_CART = `
query GetCustomerCart {
  customerCart {${CART_ITEMS}
  }
}`;

const NEEDS_TOKEN = "Needs a customer token (MAGENTO_GRAPHQL_TOKEN or `hiberus-magento-graphql auth token set`).";

export function customerTools({ readTool }: ToolFactory): readonly MagentoGraphqlTool[] {
  return [
    readTool({
      name: "magentographql_get_customer",
      description: `Use this to read the signed-in customer's profile: name, email, newsletter flag and address locations (city, region, postcode, country — no street or phone). ${NEEDS_TOKEN}`,
      input: z.object({ ...context }).strict(),
      document: CUSTOMER,
      pick: "customer",
      context: contextOf,
    }),
    readTool({
      name: "magentographql_get_customer_orders",
      description: `Use this to list the signed-in customer's orders, newest first as Magento returns them, or find one by order number: number, date, status, grand total and the items ordered. ${NEEDS_TOKEN}`,
      input: z
        .object({
          order_number: z.string().min(1).max(32).optional().describe("Only the order with this number."),
          page_size: pageSize(),
          current_page: currentPage,
          ...context,
        })
        .strict(),
      document: ORDERS,
      pick: "customer",
      variables: (a) => ({ ...(a.order_number !== undefined ? { filter: { number: { eq: a.order_number } } } : {}), pageSize: a.page_size ?? 10, currentPage: a.current_page ?? 1 }),
      transform: (value) => (value as { orders?: unknown } | null)?.orders ?? null,
      context: contextOf,
    }),
    readTool({
      name: "magentographql_get_customer_cart",
      description: `Use this to read the signed-in customer's active cart: its masked id, items with quantities and prices, totals and applied coupons. ${NEEDS_TOKEN}`,
      input: z.object({ ...context }).strict(),
      document: CUSTOMER_CART,
      pick: "customerCart",
      context: contextOf,
    }),
  ];
}
