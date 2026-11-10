// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Customer tools: four reads and three writes, ported from the original
// `src/tools/customers.js`. Customers are personal data, which drives the
// differences beyond the usual encoded paths, validated criteria and bounded
// pages:
//
//   - results are the identity minimum (`shapes.customer*`): no date of birth,
//     tax number, gender, street or telephone unless an operator adds them in
//     a reviewed MAGENTO_REST_FIELDS_FILE;
//   - `create_customer` has NO password parameter. The original accepted one,
//     which put a credential into the model's context and the conversation
//     log; Magento's own password-reset flow is how a new customer sets one;
//   - `update_customer` keeps the original's read-then-write (Magento's PUT
//     wants the identifying fields), but merges with `??`, so an explicit
//     empty value is rejected by the schema instead of silently meaning
//     "keep the old one" as the original's `||` did.
import { z } from "zod";
import { restPath, type SearchFilter } from "../client/index.js";
import { currentPage, entityId, isoDate, pageSize } from "./inputs.js";
import type { MagentoRestTool, ToolFactory } from "./rest-tool.js";
import { listOf } from "./shapes.js";

const LIST_PAGE_SIZE = 20;
const GROUPS_PAGE_SIZE = 100;

const name = (what: string) => z.string().min(1).max(100).describe(what);

function readString(record: unknown, key: string): string | undefined {
  if (record !== null && typeof record === "object" && key in record) {
    const value = (record as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function readNumber(record: unknown, key: string): number | undefined {
  if (record !== null && typeof record === "object" && key in record) {
    const value = (record as Record<string, unknown>)[key];
    return typeof value === "number" ? value : undefined;
  }
  return undefined;
}

export function customerTools({ readTool, writeTool, shapes }: ToolFactory): readonly MagentoRestTool[] {
  return [
    readTool({
      name: "magentorest_get_customer_by_id",
      description: "Use this to read one customer by numeric ID: name, email, group, website, store and the default address IDs. Date of birth, tax number and the address book are not returned.",
      input: z.object({ customer_id: entityId("customer") }).strict(),
      shape: shapes.customer,
      run: ({ customer_id }, client) => client.get(restPath`/customers/${customer_id}`),
    }),

    readTool({
      name: "magentorest_search_customers",
      description:
        "Use this to find customers by part of the email or name, by group or website, or by creation date range (YYYY-MM-DD). Filters are combined with AND. Returns a bounded page of summaries and the total count.",
      input: z
        .object({
          email: z.string().min(1).max(254).optional().describe("Text the email must contain."),
          firstname: name("Text the first name must contain.").optional(),
          lastname: name("Text the last name must contain.").optional(),
          group_id: entityId("customer group to filter by").optional(),
          website_id: entityId("website to filter by").optional(),
          created_at_from: isoDate("Created on or after this date (YYYY-MM-DD).").optional(),
          created_at_to: isoDate("Created on or before this date (YYYY-MM-DD).").optional(),
          page_size: pageSize,
          current_page: currentPage,
        })
        .strict(),
      shape: listOf(shapes.customer_summary),
      run: async (args, client) => {
        // One filter per group: groups are AND'd, which is what these mean.
        const filters: SearchFilter[] = [];
        if (args.email !== undefined) filters.push({ field: "email", value: `%${args.email}%`, conditionType: "like" });
        if (args.firstname !== undefined) filters.push({ field: "firstname", value: `%${args.firstname}%`, conditionType: "like" });
        if (args.lastname !== undefined) filters.push({ field: "lastname", value: `%${args.lastname}%`, conditionType: "like" });
        if (args.group_id !== undefined) filters.push({ field: "group_id", value: args.group_id });
        if (args.website_id !== undefined) filters.push({ field: "website_id", value: args.website_id });
        if (args.created_at_from !== undefined) filters.push({ field: "created_at", value: args.created_at_from, conditionType: "gteq" });
        if (args.created_at_to !== undefined) filters.push({ field: "created_at", value: args.created_at_to, conditionType: "lteq" });
        const result = await client.search("/customers/search", {
          filterGroups: filters.map((filter) => [filter]),
          pageSize: args.page_size ?? LIST_PAGE_SIZE,
          currentPage: args.current_page ?? 1,
        });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_customer_groups",
      description: "Use this to list the customer groups with their code and tax class.",
      input: z.object({}).strict(),
      shape: listOf(shapes.customer_group),
      run: async (_args, client) => {
        const result = await client.search("/customerGroups/search", { pageSize: GROUPS_PAGE_SIZE });
        return { items: result.items, total_count: result.totalCount };
      },
    }),

    readTool({
      name: "magentorest_get_customer_addresses",
      description:
        "Use this to list a customer's addresses by location: country, region, city, postcode and which is the default billing or shipping address. Street, telephone and the addressee are not returned.",
      input: z.object({ customer_id: entityId("customer") }).strict(),
      shape: shapes.customer_address,
      run: async ({ customer_id }, client) => {
        const customer = await client.get(restPath`/customers/${customer_id}`);
        const addresses = customer !== null && typeof customer === "object" && "addresses" in customer ? customer.addresses : undefined;
        return Array.isArray(addresses) ? addresses : [];
      },
    }),

    writeTool({
      name: "magentorest_create_customer",
      description:
        "Use this to create a customer account from an email and a name. It takes no password: Magento's own password-reset flow is how the customer sets one. Adds a record; the email must not already exist on the website.",
      effect: "create",
      input: z
        .object({
          email: z.email().describe("Customer email address."),
          firstname: name("Customer first name."),
          lastname: name("Customer last name."),
          group_id: entityId("customer group (default 1, General)").optional(),
          website_id: entityId("website (default 1)").optional(),
          store_id: entityId("store view (default 1)").optional(),
        })
        .strict(),
      shape: shapes.customer,
      run: (args, client) =>
        client.post("/customers", {
          customer: {
            email: args.email,
            firstname: args.firstname,
            lastname: args.lastname,
            group_id: args.group_id ?? 1,
            website_id: args.website_id ?? 1,
            store_id: args.store_id ?? 1,
          },
        }),
    }),

    writeTool({
      name: "magentorest_update_customer",
      description: "Use this to change a customer's email, name or group. Only the fields you pass change; at least one is required. Overwrites the current values.",
      effect: "update",
      input: z
        .object({
          customer_id: entityId("customer to update"),
          email: z.email().optional().describe("New email address."),
          firstname: name("New first name.").optional(),
          lastname: name("New last name.").optional(),
          group_id: entityId("new customer group").optional(),
        })
        .strict(),
      shape: shapes.customer,
      run: async ({ customer_id, email, firstname, lastname, group_id }, client) => {
        if (email === undefined && firstname === undefined && lastname === undefined && group_id === undefined) {
          throw new Error("magentorest_update_customer: nothing to update — pass at least one field besides the customer ID.");
        }
        // Magento's PUT wants the identifying fields, so the record is read first.
        const existing = await client.get(restPath`/customers/${customer_id}`);
        const merged = {
          id: customer_id,
          email: email ?? readString(existing, "email"),
          firstname: firstname ?? readString(existing, "firstname"),
          lastname: lastname ?? readString(existing, "lastname"),
          website_id: readNumber(existing, "website_id"),
          ...(group_id !== undefined ? { group_id } : {}),
        };
        return client.put(restPath`/customers/${customer_id}`, { customer: merged });
      },
    }),

    writeTool({
      name: "magentorest_delete_customer",
      description: "Use this to permanently delete a customer account by ID. Irreversible: the account and its address book are removed; past orders keep their own copy of the details.",
      effect: "delete",
      input: z.object({ customer_id: entityId("customer to delete") }).strict(),
      shape: [],
      run: ({ customer_id }, client) => client.delete(restPath`/customers/${customer_id}`),
    }),
  ];
}
