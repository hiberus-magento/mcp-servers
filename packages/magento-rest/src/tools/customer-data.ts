// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Customer personal data, kept out of every result by default (Kora contract R-7).
//
// An order-status question must not put a shopper's email or name into a model's context, nor into a chat history
// that keeps it. So, unless the operator sets MAGENTO_REST_CUSTOMER_DATA=true, every tool's allowlist loses the
// fields that identify or locate a person: names, email, phone, street, date of birth, tax number, gender, IP, the
// `customer_*` identity fields of an order, and a cart's embedded `customer`. The rest of each record (numbers,
// statuses, totals, lines) is unchanged.
//
// It is done on the allowlists, not on the answers: a field that is not on the list is never read out of Magento's
// response, whatever the store returns. It runs after MAGENTO_REST_FIELDS_FILE, so a field file cannot add a
// customer field back while customer data is off.
//
// The names are matched at any depth of any allowlist, so a field file that adds, say, `email` to a non-customer
// record loses it too while customer data is off. None of the shipped non-customer lists carries such a name (a test
// pins it). City and postcode are only personal in a customer's address book (`customer_address`), so a warehouse
// keeps its own.
//
// This covers the REST tools. The `database` group (magentorest_db_*, only with MAGENTO_REST_DATABASE_CONNECTION)
// runs the SQL it is given and is not filtered here: its grants are its boundary.
import type { Shape } from "./project.js";
import type { ShapeSet } from "./shapes.js";

/** Field names that identify or locate a person, at any depth of any allowlist. */
const PERSONAL_FIELDS: ReadonlySet<string> = new Set([
  "email",
  "firstname",
  "middlename",
  "lastname",
  "prefix",
  "suffix",
  "telephone",
  "fax",
  "street",
  "company",
  "dob",
  "taxvat",
  "gender",
  "remote_ip",
  "x_forwarded_for",
  // A cart's embedded customer record.
  "customer",
  // An order's copy of the customer's identity. `customer_is_guest` stays: it says nothing about who.
  "customer_id",
  "customer_email",
  "customer_firstname",
  "customer_middlename",
  "customer_lastname",
  "customer_prefix",
  "customer_suffix",
  "customer_name",
  "customer_dob",
  "customer_taxvat",
  "customer_gender",
  "customer_note",
]);

/** Whether a field or column name identifies or locates a person: what no list tool's filter or sort may name. */
export function isPersonalField(name: string): boolean {
  return PERSONAL_FIELDS.has(name);
}

/** Address fields that locate a person when the address is a customer's own. */
const CUSTOMER_ADDRESS_FIELDS: ReadonlySet<string> = new Set(["city", "postcode"]);

function without(shape: Shape, fields: ReadonlySet<string>): Shape {
  const kept: (string | readonly [string, Shape])[] = [];
  for (const entry of shape) {
    if (typeof entry === "string") {
      if (!fields.has(entry)) kept.push(entry);
    } else if (!fields.has(entry[0])) {
      kept.push([entry[0], without(entry[1], fields)]);
    }
  }
  return kept;
}

/** The allowlist without personal fields, at any depth, the rest in its order. */
export function withoutCustomerData(shape: Shape): Shape {
  return without(shape, PERSONAL_FIELDS);
}

/** The allowlists without personal fields, and a customer's address without its city and postcode. */
export function withoutCustomerDataShapes(shapes: ShapeSet): ShapeSet {
  const stripped = Object.fromEntries(Object.entries(shapes).map(([resource, shape]) => [resource, withoutCustomerData(shape)])) as Record<keyof ShapeSet, Shape>;
  return { ...stripped, customer_address: without(stripped.customer_address, CUSTOMER_ADDRESS_FIELDS) };
}
