#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Generates `packages/magento-graphql/src/tools/generated/schema-tools.ts`: one tool definition for every
// Query and Mutation of a Magento GraphQL schema that no hand-written tool covers, from an introspection result.
//
//   node scripts/gen-graphql-tools.mjs <introspection.json>
//
// The input is the JSON answer to a full `__schema { types { ... } }` query (`{ "data": { "__schema": ... } }`),
// taken with deprecated fields excluded, which is how Magento answers by default. The output is committed: a
// reviewer reads the documents that will run, and the build never needs a store.
//
// What is generated, per operation:
//   - ONE fixed document, with every argument declared as a GraphQL variable of the schema's own type;
//   - a strict zod schema for the arguments, built from the schema's input types (nothing is free-form);
//   - a selection set that is an allowlist: scalar and enum fields, plus nested objects to a depth that keeps the
//     document under 6,500 characters, skipping fields that need arguments, credential-shaped field names, and
//     recursion. Products, categories, carts and customers use short fixed selections instead of the full types.
//   - a group, an effect (which fixes the MCP annotations) and a description.
//
// Operations a hand-written tool already covers are listed in COVERED and skipped. Stock Magento only: nothing
// here knows about any particular store; an operation is generated because the schema has it.
import { readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("../packages/magento-graphql/src/tools/generated/schema-tools.ts", import.meta.url);

const COVERED = new Set([
  "cart", "cmsBlocks", "cmsPage", "countries", "country", "currency", "customer", "customerCart", "availableStores", "products", "storeConfig", "categories",
  "addProductsToCart", "applyCouponToCart", "removeCouponFromCart", "removeItemFromCart", "updateCartItems",
]);

// One group per operation. An operation missing here stops the generator, so a new schema operation is placed on purpose.
const GROUPS = {
  products: ["productReviewRatingsMetadata", "createProductReview"],
  store: ["attributesForm", "attributesList", "customAttributeMetadataV2", "route", "pickupLocations", "recaptchaFormConfig", "recaptchaV3Config", "contactUs", "sendEmailToFriend", "dynamicBlocks"],
  account: [
    "generateCustomerToken", "generateCustomerTokenAsAdmin", "revokeCustomerToken", "createCustomerV2", "updateCustomerV2", "updateCustomerEmail", "changeCustomerPassword",
    "requestPasswordResetEmail", "resetPassword", "confirmEmail", "resendConfirmationEmail", "isEmailAvailable", "deleteCustomer", "subscribeEmailToNewsletter",
    "createCustomerAddress", "updateCustomerAddressV2", "deleteCustomerAddressV2", "customerDownloadableProducts", "customerGroup", "customerSegments", "exchangeExternalCustomerToken",
  ],
  cart: [
    "createGuestCart", "addProductsToNewCart", "addSimpleProductsToCart", "addVirtualProductsToCart", "addConfigurableProductsToCart", "addBundleProductsToCart", "addDownloadableProductsToCart",
    "applyCouponsToCart", "removeCouponsFromCart", "clearCart", "clearCustomerCart", "mergeCarts", "assignCustomerToGuestCart", "setCartAsInactive", "setGiftOptionsOnCart", "reorderItems",
  ],
  checkout: [
    "setShippingAddressesOnCart", "setBillingAddressOnCart", "setShippingMethodsOnCart", "setPaymentMethodOnCart", "setGuestEmailOnCart", "estimateShippingMethods", "estimateTotals",
    "checkoutAgreements", "placeOrder",
  ],
  orders: ["guestOrder", "guestOrderByToken", "cancelOrder", "confirmCancelOrder", "requestGuestOrderCancel"],
  returns: ["requestReturn", "requestGuestReturn", "addReturnComment", "addReturnTracking", "removeReturnTracking", "confirmReturn"],
  wishlist: [
    "createWishlist", "deleteWishlist", "clearWishlist", "updateWishlist", "addProductsToWishlist", "removeProductsFromWishlist", "updateProductsInWishlist", "moveProductsBetweenWishlists",
    "copyProductsBetweenWishlists", "addWishlistItemsToCart",
  ],
  compare: ["compareList", "createCompareList", "addProductsToCompareList", "removeProductsFromCompareList", "deleteCompareList", "assignCompareListToCustomer"],
  payments: [
    "getPaymentConfig", "getPaymentOrder", "getPaymentSDK", "getVaultConfig", "customerPaymentTokens", "getHostedProUrl", "getPayflowLinkToken", "createPaypalExpressToken", "createPayflowProToken",
    "handlePayflowProResponse", "appendPaymentServicesStorefrontLogs", "createPaymentOrder", "syncPaymentOrder", "completeOrder", "createVaultCardPaymentToken", "createVaultCardSetupToken", "deletePaymentToken",
  ],
  "gift-and-rewards": [
    "giftCardAccount", "applyGiftCardToCart", "removeGiftCardFromCart", "redeemGiftCardBalanceAsStoreCredit", "applyStoreCreditToCart", "removeStoreCreditFromCart", "applyRewardPointsToCart", "removeRewardPointsFromCart",
  ],
  "gift-registry": [
    "giftRegistry", "giftRegistryEmailSearch", "giftRegistryIdSearch", "giftRegistryTypeSearch", "giftRegistryTypes", "createGiftRegistry", "updateGiftRegistry", "removeGiftRegistry", "shareGiftRegistry",
    "addGiftRegistryRegistrants", "updateGiftRegistryRegistrants", "removeGiftRegistryRegistrants", "updateGiftRegistryItems", "removeGiftRegistryItems", "moveCartItemsToGiftRegistry",
  ],
  company: [
    "company", "isCompanyAdminEmailAvailable", "isCompanyEmailAvailable", "isCompanyRoleNameAvailable", "isCompanyUserEmailAvailable", "createCompany", "updateCompany", "createCompanyRole", "updateCompanyRole",
    "deleteCompanyRole", "createCompanyTeam", "updateCompanyTeam", "deleteCompanyTeam", "createCompanyUser", "updateCompanyUser", "deleteCompanyUserV2", "updateCompanyStructure", "acceptCompanyInvitation",
  ],
  "purchase-orders": [
    "placePurchaseOrder", "placeOrderForPurchaseOrder", "addPurchaseOrderComment", "addPurchaseOrderItemsToCart", "approvePurchaseOrders", "rejectPurchaseOrders", "cancelPurchaseOrders", "validatePurchaseOrders",
    "createPurchaseOrderApprovalRule", "updatePurchaseOrderApprovalRule", "deletePurchaseOrderApprovalRule",
  ],
  quotes: [
    "negotiableQuote", "negotiableQuotes", "negotiableQuoteTemplate", "negotiableQuoteTemplates", "requestNegotiableQuote", "sendNegotiableQuoteForReview", "renameNegotiableQuote", "duplicateNegotiableQuote",
    "closeNegotiableQuotes", "deleteNegotiableQuotes", "removeNegotiableQuoteItems", "updateNegotiableQuoteQuantities", "setNegotiableQuoteBillingAddress", "setNegotiableQuoteShippingAddress",
    "setNegotiableQuoteShippingMethods", "setNegotiableQuotePaymentMethod", "placeNegotiableQuoteOrder", "setLineItemNote", "requestNegotiableQuoteTemplateFromQuote", "openNegotiableQuoteTemplate",
    "acceptNegotiableQuoteTemplate", "cancelNegotiableQuoteTemplate", "deleteNegotiableQuoteTemplate", "generateNegotiableQuoteFromTemplate", "submitNegotiableQuoteTemplateForReview",
    "removeNegotiableQuoteTemplateItems", "updateNegotiableQuoteTemplateQuantities", "setNegotiableQuoteTemplateShippingAddress", "setQuoteTemplateLineItemNote",
  ],
  "requisition-lists": [
    "createRequisitionList", "updateRequisitionList", "deleteRequisitionList", "addProductsToRequisitionList", "updateRequisitionListItems", "deleteRequisitionListItems", "addRequisitionListItemsToCart",
    "copyItemsBetweenRequisitionLists", "moveItemsBetweenRequisitionLists", "moveLineItemToRequisitionList",
  ],
};

// Groups, or single operations, that exist only on Adobe Commerce; the description says so, because on Open Source
// Magento they answer "Cannot query field".
const COMMERCE_ONLY_GROUPS = new Set(["gift-and-rewards", "gift-registry", "company", "purchase-orders", "quotes", "requisition-lists", "returns"]);
const COMMERCE_ONLY_OPERATIONS = new Set(["dynamicBlocks", "giftCardAccount", "customerSegments"]);
// Groups whose operations act on the signed-in customer.
const TOKEN_GROUPS = new Set(["wishlist", "returns", "company", "purchase-orders", "quotes", "requisition-lists", "gift-registry"]);
const TOKEN_OPERATIONS = new Set([
  "revokeCustomerToken", "updateCustomerV2", "updateCustomerEmail", "changeCustomerPassword", "deleteCustomer", "createCustomerAddress", "updateCustomerAddressV2", "deleteCustomerAddressV2", "customerGroup",
  "customerDownloadableProducts", "customerPaymentTokens", "assignCustomerToGuestCart", "clearCustomerCart", "reorderItems", "mergeCarts", "subscribeEmailToNewsletter", "createVaultCardPaymentToken",
  "createVaultCardSetupToken", "deletePaymentToken", "redeemGiftCardBalanceAsStoreCredit", "applyStoreCreditToCart", "removeStoreCreditFromCart", "applyRewardPointsToCart", "removeRewardPointsFromCart",
]);
// Operations that take a password as an argument: it passes through the conversation, and the description says so.
const PASSWORD_OPERATIONS = new Set(["generateCustomerToken", "generateCustomerTokenAsAdmin", "createCustomerV2", "updateCustomerEmail", "changeCustomerPassword", "resetPassword", "deleteCustomer"]);

const SENSITIVE_FIELD = /password|secret|cvv|api_key|card_number|private_key/i;
const MAX_DOCUMENT = 6500;

const CART_LITE = "id total_quantity is_virtual itemsV2 { total_count items { uid quantity product { sku name stock_status } prices { price { value currency } row_total { value currency } } } } prices { grand_total { value currency } subtotal_excluding_tax { value currency } discounts { label amount { value currency } } } applied_coupons { code }";
const CART_CHECKOUT = `${CART_LITE} email shipping_addresses { firstname lastname street city region { code label } postcode country { code label } selected_shipping_method { carrier_code method_code carrier_title method_title amount { value currency } } available_shipping_methods { carrier_code method_code carrier_title method_title amount { value currency } available } } billing_address { firstname lastname street city region { code label } postcode country { code label } } selected_payment_method { code title } available_payment_methods { code title }`;
const CUSTOMER_LITE = "firstname lastname email is_subscribed addresses { uid city region { region_code } postcode country_code default_shipping default_billing }";
const PRODUCT_MINI = "uid sku name url_key stock_status";
const CATEGORY_MINI = "uid name url_path";

const input = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
const types = new Map(input.data.__schema.types.map((t) => [t.name, t]));

const base = (type) => (type.ofType ? base(type.ofType) : type);
const typeString = (type) => (type.kind === "NON_NULL" ? `${typeString(type.ofType)}!` : type.kind === "LIST" ? `[${typeString(type.ofType)}]` : type.name);
const isRequiredArg = (arg) => arg.type.kind === "NON_NULL" && (arg.defaultValue === null || arg.defaultValue === undefined);
// The schema's own descriptions carry example addresses (a sample web address); the repository's audit allows only its
// synthetic identifiers, so they are rewritten to one.
const describeText = (text) => (text ?? "").replace(/\s+/g, " ").replace(/\b(?:www\.)?example\.(?:com|org|net)\b/gi, "demo-host.example-domain").trim();
const snake = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();
const pascal = (name) => name[0].toUpperCase() + name.slice(1);
const q = (text) => JSON.stringify(text);

// ---- selections ------------------------------------------------------------------------------------------------
function implementsInterface(type, name) {
  return (type.interfaces ?? []).some((i) => i.name === name);
}

function selection(typeName, depth, trail, cartVariant) {
  const type = types.get(typeName);
  if (type === undefined) return "";
  if (typeName === "Cart") return cartVariant;
  if (typeName === "Customer") return CUSTOMER_LITE;
  if (typeName === "ProductInterface" || implementsInterface(type, "ProductInterface")) return PRODUCT_MINI;
  if (typeName === "CategoryInterface" || typeName === "CategoryTree" || implementsInterface(type, "CategoryInterface")) return CATEGORY_MINI;
  if (type.kind === "UNION") return "__typename";
  if (type.kind !== "OBJECT" && type.kind !== "INTERFACE") return "";
  const scalars = [];
  const nested = [];
  for (const field of type.fields ?? []) {
    if (SENSITIVE_FIELD.test(field.name) || field.name.startsWith("__")) continue;
    if ((field.args ?? []).some(isRequiredArg)) continue;
    const target = base(field.type);
    const targetType = types.get(target.name);
    if (targetType === undefined) continue;
    if (targetType.kind === "SCALAR" || targetType.kind === "ENUM") {
      scalars.push(field.name);
    } else if (depth > 1 && !trail.includes(target.name)) {
      const inner = selection(target.name, depth - 1, [...trail, typeName], cartVariant);
      if (inner !== "") nested.push(`${field.name} { ${inner} }`);
    }
  }
  const parts = [...(type.kind === "INTERFACE" ? ["__typename"] : []), ...scalars, ...nested];
  return parts.join(" ");
}

// ---- input schemas (zod source) --------------------------------------------------------------------------------
const emittedEnums = new Map();
const emittedInputs = new Map();

function zodNamed(target) {
  const type = types.get(target.name);
  if (type.kind === "SCALAR") {
    if (target.name === "Int") return "z.number().int()";
    if (target.name === "Float") return "z.number()";
    if (target.name === "Boolean") return "z.boolean()";
    return "z.string()";
  }
  if (type.kind === "ENUM") {
    if (!emittedEnums.has(type.name)) emittedEnums.set(type.name, `const E_${type.name} = z.enum([${type.enumValues.map((v) => q(v.name)).join(", ")}]);`);
    return `E_${type.name}`;
  }
  if (type.kind === "INPUT_OBJECT") {
    if (!emittedInputs.has(type.name)) {
      emittedInputs.set(type.name, "");
      emittedInputs.set(type.name, inputObjectSource(type));
    }
    return `I_${type.name}`;
  }
  throw new Error(`unsupported argument type ${target.name} (${type.kind})`);
}

function zodType(type) {
  if (type.kind === "NON_NULL") return zodType(type.ofType);
  if (type.kind === "LIST") return `z.array(${zodType(type.ofType)})`;
  return zodNamed(type);
}

function fieldSource(name, type, required, description) {
  const text = describeText(description).slice(0, 160);
  return `${name}: ${zodType(type)}${required ? "" : ".optional()"}${text !== "" ? `.describe(${q(text)})` : ""}`;
}

function inputObjectSource(type) {
  const fields = (type.inputFields ?? []).map((f) => fieldSource(f.name, f.type, f.type.kind === "NON_NULL" && (f.defaultValue === null || f.defaultValue === undefined), f.description));
  // Lazy: input types refer to each other, and some to themselves.
  return `const I_${type.name}: z.ZodType = z.lazy(() => z.object({ ${fields.join(", ")} }).strict());`;
}

// ---- operations ------------------------------------------------------------------------------------------------
function effectOf(name) {
  if (/^(delete|remove|clear|revoke|close)/.test(name)) return "delete";
  if (/^(create|register)/.test(name) && !/^create(PaypalExpressToken|PayflowProToken|PaymentOrder|VaultCard)/.test(name)) return "create";
  if (/^(update|set|rename|apply|assign|resend|confirmEmail|resetPassword|changeCustomerPassword|subscribe|syncPaymentOrder)/.test(name)) return "update";
  return "action";
}

function descriptionOf(op, group, kind) {
  let text = describeText(op.description);
  if (text === "") text = `${kind === "query" ? "Read" : "Run"} ${snake(op.name).replace(/_/g, " ")}`;
  text = text.replace(/\.$/, "");
  const lower = /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
  const notes = [];
  if (COMMERCE_ONLY_GROUPS.has(group) || COMMERCE_ONLY_OPERATIONS.has(op.name)) notes.push("Adobe Commerce only: Open Source Magento does not have it.");
  if (TOKEN_GROUPS.has(group) || TOKEN_OPERATIONS.has(op.name)) notes.push("Needs a customer token.");
  if (PASSWORD_OPERATIONS.has(op.name)) notes.push("Takes a password as an argument, which then passes through the conversation.");
  if (op.name === "generateCustomerToken" || op.name === "generateCustomerTokenAsAdmin" || op.name === "exchangeExternalCustomerToken") notes.push("Returns a credential into the conversation; store it with `hiberus-magento-graphql auth token set` rather than reusing it from here.");
  if (op.name === "placeOrder") notes.push("Places a real order from the cart: not idempotent and never retried.");
  return `Use this to ${lower}.${notes.length > 0 ? ` ${notes.join(" ")}` : ""}`.slice(0, 700);
}

const groupOf = new Map();
for (const [group, names] of Object.entries(GROUPS)) for (const n of names) {
  if (groupOf.has(n)) throw new Error(`${n} is in two groups`);
  groupOf.set(n, group);
}

const operations = [];
for (const [kind, rootName] of [["query", "Query"], ["mutation", "Mutation"]]) {
  for (const op of types.get(rootName).fields) {
    if (COVERED.has(op.name)) continue;
    const group = groupOf.get(op.name);
    if (group === undefined) throw new Error(`${kind} ${op.name} has no group: add it to GROUPS in scripts/gen-graphql-tools.mjs`);
    if ((op.args ?? []).some((a) => a.name === "store" || a.name === "currency")) throw new Error(`${op.name} has an argument that collides with the store/currency context arguments`);
    const returnBase = base(op.type);
    const cartVariant = group === "checkout" || /Cart|ShippingMethods|Totals/.test(op.name) ? CART_CHECKOUT : CART_LITE;
    let document = "";
    for (const depth of [3, 2, 1]) {
      const sel = selection(returnBase.name, depth, [], cartVariant);
      const decls = (op.args ?? []).map((a) => `$${a.name}: ${typeString(a.type)}`);
      const uses = (op.args ?? []).map((a) => `${a.name}: $${a.name}`);
      document = `${kind} ${pascal(op.name)}${decls.length > 0 ? `(${decls.join(", ")})` : ""} { ${op.name}${uses.length > 0 ? `(${uses.join(", ")})` : ""}${sel !== "" ? ` { ${sel} }` : ""} }`;
      if (document.length <= MAX_DOCUMENT) break;
    }
    if (document.length > MAX_DOCUMENT) throw new Error(`${op.name}: document is ${document.length} characters even at depth 1`);
    // Magento declares `input` nullable on many mutations, but a call without it never means anything: the tool requires it.
    const requiredForTool = (a) => isRequiredArg(a) || (a.name === "input" && types.get(base(a.type).name)?.kind === "INPUT_OBJECT");
    const fields = (op.args ?? []).map((a) => fieldSource(a.name, a.type, requiredForTool(a), a.description));
    operations.push({
      name: `magentographql_${kind === "query" && !/^(get|is)_/.test(snake(op.name)) ? "get_" : ""}${snake(op.name)}`,
      operation: op.name,
      kind,
      group,
      effect: kind === "query" ? "read" : effectOf(op.name),
      description: descriptionOf(op, group, kind),
      document,
      fields,
    });
  }
}

const names = operations.map((o) => o.name);
if (new Set(names).size !== names.length) throw new Error(`duplicate tool names: ${names.filter((n, i) => names.indexOf(n) !== i).join(", ")}`);

const lines = [];
lines.push("// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.");
lines.push("//");
lines.push("// GENERATED by scripts/gen-graphql-tools.mjs from a Magento GraphQL introspection result. Do not edit by hand:");
lines.push("// change the generator and run it again. Every document below is fixed text, and every argument reaches it only as a");
lines.push("// GraphQL variable. See openspec/changes/2026-11-05-magento-graphql-package/design.md D11.");
lines.push('import { z } from "zod";');
lines.push('import type { GeneratedOperation } from "./types.js";');
lines.push("");
for (const source of [...emittedEnums.values()].sort()) lines.push(source);
for (const source of [...emittedInputs.values()].sort()) lines.push(source);
lines.push("");
lines.push("export const GENERATED_OPERATIONS: readonly GeneratedOperation[] = [");
for (const o of operations) {
  lines.push("  {");
  lines.push(`    name: ${q(o.name)},`);
  lines.push(`    operation: ${q(o.operation)},`);
  lines.push(`    kind: ${q(o.kind)},`);
  lines.push(`    group: ${q(o.group)},`);
  lines.push(`    effect: ${q(o.effect)},`);
  lines.push(`    description: ${q(o.description)},`);
  lines.push(`    document: ${q(o.document)},`);
  // A thunk, so a server that loads a few groups builds only their schemas.
  lines.push(`    input: () => z.object({ ${o.fields.join(", ")} }).strict(),`);
  lines.push("  },");
}
lines.push("];");
lines.push("");
writeFileSync(OUT, lines.join("\n"));
const byGroup = Object.groupBy(operations, (o) => o.group);
process.stdout.write(`gen-graphql-tools: ${operations.length} operations (${operations.filter((o) => o.kind === "query").length} queries, ${operations.filter((o) => o.kind === "mutation").length} mutations), ${emittedInputs.size} input types, ${emittedEnums.size} enums\n`);
for (const [group, list] of Object.entries(byGroup)) process.stdout.write(`  ${group}: ${list.length}\n`);
