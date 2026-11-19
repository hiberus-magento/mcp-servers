// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Direct database tools: eight reads and one write, ported from the original's `database.js`. They exist for the
// questions the REST API cannot answer cheaply (a count, a join, a table's columns); for anything it can answer,
// the `magentorest_get_*` tools are the better first choice.
//
// How they differ from the REST tools, and why:
//   - Results cannot be allowlisted per field, so `db/rows.ts` strips credential columns and secret
//     configuration values from whatever comes back, and `db/sql-guard.ts` refuses the credential tables outright.
//   - The reads run in a READ ONLY session with a row cap and a timeout (`db/access.ts`).
//   - The one write, `db_execute`, exists only when `MAGENTO_REST_DATABASE_ALLOW_WRITES=true` — a switch of its
//     own, independent of `MAGENTO_REST_ALLOW_WRITES`: allowing the REST API to change orders is not allowing
//     SQL to change rows. It is transactional, can be a dry run, and rolls back instead of changing more rows
//     than the caller said to expect.
//   - Every statement the fixed tools send is a constant; values are always bound parameters.
import { defineTool, type ToolAnnotations } from "@hiberus-magento/mcp-core";
import { z } from "zod";
import { type DatabaseAccess, type ReadRunner } from "../db/access.js";
import { SENSITIVE_TABLES, SqlGuardError } from "../db/sql-guard.js";
import { READ_ONLY_ANNOTATIONS, WRITE_ANNOTATIONS, type Access, type MagentoRestTool } from "./rest-tool.js";
import { LIVE_VERIFIED_TOOLS, UNVERIFIED_DETAIL, UNVERIFIED_MARKER } from "./verification.js";

const SQL_PARAM = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

const params = z.array(SQL_PARAM).max(50).optional().describe("Values for the ? placeholders in the statement, in order. Always pass values here instead of writing them into the SQL.");

/** The tables the original named as "the core ones", grouped as it grouped them. */
const MAGENTO_TABLES: Readonly<Record<string, readonly string[]>> = {
  products: ["catalog_product_entity", "catalog_product_entity_varchar", "catalog_product_entity_text", "catalog_product_entity_int", "catalog_product_entity_decimal", "catalog_product_entity_datetime", "cataloginventory_stock_item"],
  categories: ["catalog_category_entity", "catalog_category_entity_varchar", "catalog_category_entity_text", "catalog_category_entity_int", "catalog_category_product"],
  customers: ["customer_entity", "customer_entity_varchar", "customer_entity_int", "customer_address_entity", "customer_group"],
  orders: ["sales_order", "sales_order_item", "sales_order_address", "sales_order_payment", "sales_order_status_history", "sales_order_grid"],
  quotes: ["quote", "quote_item", "quote_address", "quote_payment"],
  invoices: ["sales_invoice", "sales_invoice_item", "sales_invoice_grid"],
  shipments: ["sales_shipment", "sales_shipment_item", "sales_shipment_track", "sales_shipment_grid"],
  cms: ["cms_page", "cms_block"],
  eav: ["eav_attribute", "eav_attribute_set", "eav_entity_type"],
  url_rewrites: ["url_rewrite"],
  store: ["store", "store_group", "store_website"],
};

const STATS_TABLES = ["catalog_product_entity", "catalog_category_entity", "customer_entity", "sales_order", "sales_order_item", "quote", "cms_page", "cms_block"] as const;

const ORDER_COLUMNS = "entity_id, increment_id, status, state, customer_email, customer_firstname, customer_lastname, grand_total, total_qty_ordered, order_currency_code, created_at, updated_at";

const LIST_CAP = 1000;
const TABLE_LIST_CAP = 5000;

const tableName = z.string().regex(/^[A-Za-z0-9_]{1,64}$/, "letters, digits and underscore only (max 64)");

export function databaseTools(db: DatabaseAccess): readonly MagentoRestTool[] {
  function build<S extends z.ZodObject>(spec: { name: `magentorest_${string}`; description: string; input: S; access: Access; annotations: ToolAnnotations; run: (args: z.infer<S>) => Promise<unknown> }): MagentoRestTool {
    const description = LIVE_VERIFIED_TOOLS.has(spec.name) ? spec.description : `${spec.description} ${UNVERIFIED_MARKER} — ${UNVERIFIED_DETAIL}`;
    const tool = defineTool({ name: spec.name, description, inputSchema: spec.input, annotations: spec.annotations, handler: (args) => spec.run(args) });
    return { ...tool, access: spec.access } as unknown as MagentoRestTool;
  }

  const read = <S extends z.ZodObject>(spec: { name: `magentorest_${string}`; description: string; input: S; run: (args: z.infer<S>) => Promise<unknown> }): MagentoRestTool =>
    build({ ...spec, access: "read", annotations: READ_ONLY_ANNOTATIONS });

  const one = (run: ReadRunner, sql: string, values: readonly unknown[] = []) => run(sql, values, 1);

  return [
    read({
      name: "magentorest_db_status",
      description: "Use this to check that the database connection works: returns the server version, the database name, that the session is read-only, and whether database writes are enabled. Run it first when a database tool fails.",
      input: z.object({}).strict(),
      run: async () => {
        const result = await db.read((run) => one(run, "SELECT VERSION() AS version, DATABASE() AS database_name"));
        const row = result.rows[0] ?? {};
        return { connected: true, server_version: row["version"] ?? null, database: row["database_name"] ?? null, session: "read-only", writes_enabled: db.writesEnabled };
      },
    }),

    read({
      name: "magentorest_db_list_tables",
      description: "Use this to list the tables of the Magento database, optionally only those whose name contains a fragment (e.g. `sales_order`). Returns each table's name, engine and approximate row count (an estimate, not a count: use magentorest_db_stats or a COUNT(*) for exact figures).",
      input: z.object({ filter: z.string().regex(/^[A-Za-z0-9_]{1,64}$/, "letters, digits and underscore only").optional().describe("Part of a table name; case-insensitive.") }).strict(),
      run: async ({ filter }) => {
        const pattern = `%${(filter ?? "").replaceAll("_", "\\_")}%`;
        const result = await db.read((run) =>
          run("SELECT table_name AS name, table_rows AS approximate_rows, engine FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE ? ORDER BY table_name", [pattern], LIST_CAP),
        );
        const tables = result.rows.filter((row) => !SENSITIVE_TABLES.has(String(row["name"]).toLowerCase()));
        return { count: tables.length, truncated: result.truncated, tables };
      },
    }),

    read({
      name: "magentorest_db_describe_table",
      description: "Use this to see the columns of one table: name, type, whether it can be NULL, key, default and extra. Refuses the tables that hold credentials (administrators, OAuth tokens, integrations).",
      input: z.object({ table_name: tableName.describe("The table to describe, e.g. sales_order.") }).strict(),
      run: async ({ table_name }) => {
        if (SENSITIVE_TABLES.has(table_name.toLowerCase())) {
          throw new SqlGuardError(`the table ${table_name.toLowerCase()} holds credentials and cannot be described`);
        }
        const result = await db.read((run) =>
          run("SELECT column_name, column_type, is_nullable, column_key, column_default, extra FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position", [table_name], LIST_CAP),
        );
        if (result.rows.length === 0) {
          return `Table "${table_name}" not found in this database.`;
        }
        return { table: table_name, column_count: result.rows.length, columns: result.rows };
      },
    }),

    read({
      name: "magentorest_db_query",
      description:
        "Use this for a question the other tools cannot answer: runs ONE read-only SELECT and returns its columns and rows. Name the columns (SELECT * is refused; COUNT(*) is fine), pass values as ? placeholders in params, and expect at most max_rows rows (default 100, at most 500; a LIMIT above that is refused, none is added for you). " +
        "No comments, no second statement, no INTO, no locking, and no credential tables (administrators, OAuth tokens, integrations); values of columns named like a password, hash or token, and of secret configuration rows, come back as [redacted].",
      input: z
        .object({
          sql: z.string().min(1).max(10_000).describe("A single SELECT statement."),
          params,
          max_rows: z.number().int().min(1).max(500).optional().describe("Most rows to return, 1 to 500 (default 100)."),
        })
        .strict(),
      run: async ({ sql, params: values, max_rows }) => {
        const result = await db.read((run) => run(sql, values ?? [], max_rows ?? 100));
        return { columns: result.columns, row_count: result.rows.length, truncated: result.truncated, rows: result.rows };
      },
    }),

    read({
      name: "magentorest_db_magento_tables",
      description: "Use this to see the well-known Magento 2 tables grouped by what they hold (products, categories, customers, orders, quotes, invoices, shipments, CMS, EAV, URL rewrites, store), each marked with whether it exists in this database. Table prefixes are not applied.",
      input: z.object({}).strict(),
      run: async () => {
        const result = await db.read((run) => run("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name", [], TABLE_LIST_CAP));
        const existing = new Set(result.rows.map((row) => String(row["name"]).toLowerCase()));
        return Object.fromEntries(Object.entries(MAGENTO_TABLES).map(([group, tables]) => [group, tables.map((name) => ({ name, exists: existing.has(name) }))]));
      },
    }),

    read({
      name: "magentorest_db_product_by_sku",
      description: "Use this for a quick look at one product straight from the database: id, SKU, type, created and updated dates, quantity and in-stock flag (legacy stock table). For the full product use magentorest_get_product_by_sku.",
      input: z.object({ sku: z.string().min(1).max(64).describe("The SKU (Stock Keeping Unit) of the product.") }).strict(),
      run: async ({ sku }) => {
        const result = await db.read((run) =>
          one(
            run,
            "SELECT e.entity_id, e.sku, e.type_id, e.created_at, e.updated_at, stock.qty, stock.is_in_stock FROM catalog_product_entity e LEFT JOIN cataloginventory_stock_item stock ON e.entity_id = stock.product_id WHERE e.sku = ?",
            [sku],
          ),
        );
        const product = result.rows[0];
        return product === undefined ? { found: false, sku } : { found: true, product };
      },
    }),

    read({
      name: "magentorest_db_recent_orders",
      description: "Use this to see the latest orders straight from the database: id, increment id, status, state, customer email and name, totals, currency and dates. Newest first; limit defaults to 10, at most 100. Never returns addresses or payment data.",
      input: z.object({ limit: z.number().int().min(1).max(100).optional().describe("How many orders, 1 to 100 (default 10).") }).strict(),
      run: async ({ limit }) => {
        const count = limit ?? 10;
        const result = await db.read((run) => run(`SELECT ${ORDER_COLUMNS} FROM sales_order ORDER BY created_at DESC LIMIT ${count}`, [], count));
        return { count: result.rows.length, orders: result.rows };
      },
    }),

    read({
      name: "magentorest_db_stats",
      description: "Use this to count the rows of the key tables in one call: products, categories, customers, orders, order items, quotes, CMS pages and blocks. A table that does not exist says so.",
      input: z.object({}).strict(),
      run: async () =>
        db.read(async (run) => {
          const stats: Record<string, unknown> = {};
          for (const table of STATS_TABLES) {
            try {
              const result = await one(run, `SELECT COUNT(*) AS count FROM ${table}`);
              stats[table] = result.rows[0]?.["count"] ?? null;
            } catch (error) {
              if ((error as { code?: unknown } | null)?.code !== "ER_NO_SUCH_TABLE") {
                throw error;
              }
              stats[table] = "table not found";
            }
          }
          return stats;
        }),
    }),

    build({
      name: "magentorest_db_execute",
      description:
        "Use this ONLY when no other tool can make the change: runs ONE INSERT, UPDATE or DELETE (UPDATE and DELETE need a WHERE) in a transaction. It bypasses Magento's own validation, indexing and events, so a change made here may not show on the storefront until a reindex and cache flush. " +
        "Try it first with dry_run=true: the statement runs and is rolled back, and you see how many rows it would change. It rolls back by itself, changing nothing, if more than max_affected rows (default 100, at most 10000) would change. No DDL (DROP, ALTER, TRUNCATE), no REPLACE, no comments, no credential tables. Irreversible once committed.",
      input: z
        .object({
          sql: z.string().min(1).max(10_000).describe("A single INSERT, UPDATE or DELETE statement."),
          params,
          dry_run: z.boolean().optional().describe("Run and roll back, to see the effect without saving it (default false)."),
          max_affected: z.number().int().min(1).max(10_000).optional().describe("Most rows the statement may change; above this it is rolled back (default 100)."),
        })
        .strict(),
      access: "write",
      annotations: WRITE_ANNOTATIONS.action,
      run: async ({ sql, params: values, dry_run, max_affected }) => {
        const outcome = await db.write(sql, values ?? [], { dryRun: dry_run ?? false, maxAffected: max_affected ?? 100 });
        const result = { statement: outcome.kind, affected_rows: outcome.affectedRows, insert_id: outcome.insertId, committed: outcome.committed };
        return outcome.committed ? result : { ...result, note: "Dry run: the statement was rolled back and nothing was saved." };
      },
    }),
  ];
}
