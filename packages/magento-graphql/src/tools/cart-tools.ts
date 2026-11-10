// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Carts. `get_cart` is a read and always available; the five mutations are registered only with
// MAGENTO_GRAPHQL_ALLOW_WRITES=true (`tools/index.ts`). A guest cart is addressed by its masked
// id alone, so no token is needed to read or change one; a customer cart is reached through the
// customer tools.
//
// Creating a cart is `create_guest_cart` (generated from the schema): `createEmptyCart` is deprecated.
//
// A cart carries no email, address or name here: the documents select items, prices and coupons only.
import { z } from "zod";
import type { MagentoGraphqlTool, ToolFactory } from "./graphql-tool.js";
import { cartId, context, contextOf, sku, uid } from "./inputs.js";

const CART = `
    id
    total_quantity
    is_virtual
    itemsV2 {
      total_count
      items {
        uid
        quantity
        product { sku name stock_status }
        prices { price { value currency } row_total { value currency } total_item_discount { value } }
      }
    }
    prices {
      grand_total { value currency }
      subtotal_excluding_tax { value currency }
      discounts { label amount { value currency } }
    }
    applied_coupons { code }`;

const GET_CART = `query GetCart($cartId: String!) { cart(cart_id: $cartId) {${CART} } }`;
const ADD = `
mutation AddProductsToCart($cartId: String!, $items: [CartItemInput!]!) {
  addProductsToCart(cartId: $cartId, cartItems: $items) {
    cart {${CART} }
    user_errors { code message }
  }
}`;
const UPDATE = `
mutation UpdateCartItems($cartId: String!, $items: [CartItemUpdateInput!]!) {
  updateCartItems(input: { cart_id: $cartId, cart_items: $items }) {
    cart {${CART} }
  }
}`;
const REMOVE = `
mutation RemoveItemFromCart($cartId: String!, $itemUid: ID!) {
  removeItemFromCart(input: { cart_id: $cartId, cart_item_uid: $itemUid }) {
    cart {${CART} }
  }
}`;
const APPLY = `
mutation ApplyCouponToCart($cartId: String!, $code: String!) {
  applyCouponToCart(input: { cart_id: $cartId, coupon_code: $code }) {
    cart {${CART} }
  }
}`;
const REMOVE_COUPON = `
mutation RemoveCouponFromCart($cartId: String!) {
  removeCouponFromCart(input: { cart_id: $cartId }) {
    cart {${CART} }
  }
}`;

const quantity = z.number().min(0.0001).max(1000);

export function cartTools({ readTool, writeTool }: ToolFactory): readonly MagentoGraphqlTool[] {
  return [
    readTool({
      name: "magentographql_get_cart",
      description: "Use this to read a cart by its masked id: items with quantities and prices, totals, discounts and applied coupons.",
      input: z.object({ cart_id: cartId, ...context }).strict(),
      document: GET_CART,
      pick: "cart",
      variables: (a) => ({ cartId: a.cart_id }),
      context: contextOf,
    }),
    writeTool({
      name: "magentographql_add_products_to_cart",
      description:
        "Use this to add products to a cart by SKU and quantity. Not idempotent: running it twice adds the quantity twice, and it is never retried. Returns the cart and any user_errors (for example insufficient stock).",
      input: z.object({ cart_id: cartId, items: z.array(z.object({ sku, quantity }).strict()).min(1).max(20).describe("1 to 20 items: { sku, quantity }."), ...context }).strict(),
      document: ADD,
      effect: "action",
      pick: "addProductsToCart",
      variables: (a) => ({ cartId: a.cart_id, items: a.items }),
      context: contextOf,
    }),
    writeTool({
      name: "magentographql_update_cart_items",
      description: "Use this to set the quantity of items already in a cart, by cart item uid (from magentographql_get_cart). A quantity of 0 removes the item. Returns the cart.",
      input: z.object({ cart_id: cartId, items: z.array(z.object({ cart_item_uid: uid("cart item"), quantity: z.number().min(0).max(1000) }).strict()).min(1).max(20).describe("1 to 20 items: { cart_item_uid, quantity }."), ...context }).strict(),
      document: UPDATE,
      effect: "update",
      pick: "updateCartItems",
      variables: (a) => ({ cartId: a.cart_id, items: a.items }),
      context: contextOf,
    }),
    writeTool({
      name: "magentographql_remove_cart_item",
      description: "Use this to remove one item from a cart, by cart item uid (from magentographql_get_cart). Returns the cart.",
      input: z.object({ cart_id: cartId, cart_item_uid: uid("cart item"), ...context }).strict(),
      document: REMOVE,
      effect: "delete",
      pick: "removeItemFromCart",
      variables: (a) => ({ cartId: a.cart_id, itemUid: a.cart_item_uid }),
      context: contextOf,
    }),
    writeTool({
      name: "magentographql_apply_coupon",
      description: "Use this to apply a coupon code to a cart, replacing any coupon already applied. Returns the cart with its discounts.",
      input: z.object({ cart_id: cartId, coupon_code: z.string().min(1).max(255).describe("The coupon code."), ...context }).strict(),
      document: APPLY,
      effect: "update",
      pick: "applyCouponToCart",
      variables: (a) => ({ cartId: a.cart_id, code: a.coupon_code }),
      context: contextOf,
    }),
    writeTool({
      name: "magentographql_remove_coupon",
      description: "Use this to remove the coupon applied to a cart. Returns the cart.",
      input: z.object({ cart_id: cartId, ...context }).strict(),
      document: REMOVE_COUPON,
      effect: "update",
      pick: "removeCouponFromCart",
      variables: (a) => ({ cartId: a.cart_id }),
      context: contextOf,
    }),
  ];
}
