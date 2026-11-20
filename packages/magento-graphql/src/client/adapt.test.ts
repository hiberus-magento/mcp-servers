// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. A fixed document (`adapt: true`) is adapted to the connected store's schema (design D14): the schema is
// read once per client, a missing operation is refused before any request beyond that read, and without a schema
// the client falls back to sending the full document and retrying a QUERY without the fields Magento names.
import { SYNTHETIC_MAGENTO_GRAPHQL_URL } from "@hiberus-magento/mcp-testing";
import { describe, expect, it } from "vitest";
import { createFetchDouble, data, gqlErrors, json, type RecordedCall, type RouteResponse } from "../testing/fetch-double.js";
import { introspectionOf, isIntrospection, schemaDouble } from "../testing/schema-double.js";
import { SCHEMA_RETRY_MS, createSchemaSource } from "./adapt.js";
import { MagentoGraphqlError, OperationGuardError, createMagentoGraphqlClient, type MagentoGraphqlClientDeps } from "./index.js";

const STORE = {
  Query: { cart: "Cart(cart_id)", storeConfig: "StoreConfig" },
  Mutation: { applyCouponToCart: "ApplyCouponOutput(input)" },
  ApplyCouponOutput: { cart: "Cart" },
  Cart: { id: "String", total_quantity: "Float" },
  StoreConfig: { store_code: "String" },
};

const GET_CART = "query GetCart($id: String!, $page: Int) { cart(cart_id: $id, page: $page) { id is_virtual total_quantity } }";
const APPLY = "mutation Apply($id: String!) { applyCouponToCart(input: { cart_id: $id }) { cart { id gift { x } } } }";

function build(answer: (call: RecordedCall) => RouteResponse | undefined, schema: RouteResponse | ((n: number) => RouteResponse) = schemaDouble(STORE), more: Partial<MagentoGraphqlClientDeps> = {}) {
  let introspections = 0;
  const double = createFetchDouble((call) => {
    if (isIntrospection(call.request?.query)) {
      introspections += 1;
      return typeof schema === "function" ? schema(introspections) : schema;
    }
    return answer(call) ?? data({ cart: { id: "AbC123xyz" } });
  });
  // A clock the rate limiter's sleeps advance: a frozen one would wait forever past the burst.
  let clock = 0;
  const client = createMagentoGraphqlClient({ fetch: double.fetch, now: () => clock, sleep: async (ms) => { clock += ms; }, baseUrl: SYNTHETIC_MAGENTO_GRAPHQL_URL, getToken: async () => undefined, ...more });
  const sent = (): RecordedCall[] => double.calls.filter((c) => !isIntrospection(c.request?.query));
  const advance = (ms: number): void => {
    clock += ms;
  };
  return { double, client, sent, advance, introspections: () => introspections };
}

describe("a fixed document against a store whose schema is readable", () => {
  it("is sent without the fields and arguments the store lacks, and without the variables that frees", async () => {
    const { client, sent } = build(() => undefined);
    await client.query(GET_CART, { adapt: true, variables: { id: "AbC123xyz", page: 2 } });
    expect(sent()[0]?.request?.query).toBe("query GetCart($id: String!) { cart(cart_id: $id) { id total_quantity } }");
    expect(sent()[0]?.request?.variables).toEqual({ id: "AbC123xyz" });
  });

  it("reads the schema once per client, concurrent calls and other views sharing it", async () => {
    const { client, introspections, sent } = build(() => undefined);
    await Promise.all([client.query(GET_CART, { adapt: true }), client.query(GET_CART, { adapt: true }), client.with({}).query(GET_CART, { adapt: true })]);
    await client.query(GET_CART, { adapt: true });
    expect(introspections()).toBe(1);
    expect(sent()).toHaveLength(4);
  });

  it("refuses an operation the store does not offer, with a classified error and no request beyond the schema read", async () => {
    const { client, double } = build(() => undefined);
    const failure = await client.query("query Q { company { id } }", { adapt: true }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(MagentoGraphqlError);
    expect(failure).toMatchObject({ kind: "unsupported-operation", retryable: false });
    expect((failure as Error).message).toMatch(/connected store does not offer the query `company`/);
    expect((failure as MagentoGraphqlError).remedy).toMatch(/magentographql_list_operations/);
    expect(double.calls).toHaveLength(1);
    await expect(client.mutate("mutation M { createCompany { id } }", { adapt: true })).rejects.toMatchObject({ kind: "unsupported-operation" });
    expect(double.calls).toHaveLength(1);
  });

  it("refuses an operation of which the store has none of the selected fields", async () => {
    const { client, sent } = build(() => undefined);
    await expect(client.query("query Q { storeConfig { locale } }", { adapt: true })).rejects.toMatchObject({ kind: "unsupported-operation", message: expect.stringMatching(/none of the fields/) });
    expect(sent()).toHaveLength(0);
  });

  it("checks the operation kind before reading the schema", async () => {
    const { client, double } = build(() => undefined);
    await expect(client.query(APPLY, { adapt: true })).rejects.toBeInstanceOf(OperationGuardError);
    expect(double.calls).toHaveLength(0);
  });

  it("tells the listener, once, which operations the store offers", async () => {
    const seen: Array<(kind: "query" | "mutation", operation: string) => boolean> = [];
    const { client } = build(() => undefined, schemaDouble(STORE), { onSchema: (offers) => seen.push(offers) });
    await client.query(GET_CART, { adapt: true });
    await client.query(GET_CART, { adapt: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.("query", "cart")).toBe(true);
    expect(seen[0]?.("query", "company")).toBe(false);
    expect(seen[0]?.("mutation", "applyCouponToCart")).toBe(true);
  });
});

describe("a document that is not fixed", () => {
  it("is sent exactly as written, and the schema is not read", async () => {
    const { client, double } = build(() => undefined);
    await client.query(GET_CART, { variables: { id: "AbC123xyz", page: 2 } });
    expect(double.calls).toHaveLength(1);
    expect(double.calls[0]?.request?.query).toBe(GET_CART);
    expect(double.calls[0]?.request?.variables).toEqual({ id: "AbC123xyz", page: 2 });
  });

  it("is never adapted by a client built without adaptation", async () => {
    const { client, double } = build(() => undefined, schemaDouble(STORE), { adaptToSchema: false });
    await client.query(GET_CART, { adapt: true });
    expect(double.calls).toHaveLength(1);
    expect(double.calls[0]?.request?.query).toBe(GET_CART);
  });
});

describe("when the schema cannot be read", () => {
  it("sends the full document; a store that refuses introspection is not asked again", async () => {
    const { client, sent, introspections } = build(() => undefined, gqlErrors(["GraphQL introspection is not allowed, but the query contained __schema or __type"]));
    await client.query(GET_CART, { adapt: true, variables: { id: "AbC123xyz" } });
    await client.query(GET_CART, { adapt: true, variables: { id: "AbC123xyz" } });
    expect(sent().map((c) => c.request?.query)).toEqual([GET_CART, GET_CART]);
    expect(introspections()).toBe(1);
  });

  it.each([
    ["a 5xx", json(503, {})],
    ["an HTML page from a proxy", { status: 200, headers: { "content-type": "text/html" }, body: "<html>blocked</html>" }],
    ["a 404", json(404, {})],
  ] as const)("after %s, sends the full document, waits before reading the schema again, then adapts", async (_, failure) => {
    let down = true;
    const { client, sent, introspections, advance } = build(() => undefined, () => (down ? failure : schemaDouble(STORE)));
    await client.query(GET_CART, { adapt: true, variables: { id: "AbC123xyz" } });
    expect(sent()[0]?.request?.query).toBe(GET_CART);
    down = false;
    const before = introspections();
    await client.query(GET_CART, { adapt: true, variables: { id: "AbC123xyz" } });
    expect(introspections()).toBe(before);
    expect(sent()[1]?.request?.query).toBe(GET_CART);
    advance(SCHEMA_RETRY_MS);
    await client.query(GET_CART, { adapt: true, variables: { id: "AbC123xyz" } });
    expect(introspections()).toBe(before + 1);
    expect(sent()[2]?.request?.query).toBe("query GetCart($id: String!) { cart(cart_id: $id) { id total_quantity } }");
  });

  it("retries a QUERY once per field Magento says does not exist, without that field", async () => {
    const { client, sent } = build((call) =>
      call.request?.query.includes("is_virtual") === true
        ? gqlErrors(['Cannot query field "is_virtual" on type "Cart".'])
        : call.request?.query.includes("total_quantity") === true
          ? gqlErrors(['Cannot query field "total_quantity" on type "Cart". Did you mean "total_qty"?'])
          : data({ cart: { id: "AbC123xyz" } }),
      gqlErrors(["introspection disabled"]),
    );
    expect((await client.query(GET_CART, { adapt: true, variables: { id: "AbC123xyz" } })).data).toEqual({ cart: { id: "AbC123xyz" } });
    expect(sent().map((c) => c.request?.query)).toEqual([
      GET_CART,
      "query GetCart($id: String!, $page: Int) { cart(cart_id: $id, page: $page) { id total_quantity } }",
      "query GetCart($id: String!, $page: Int) { cart(cart_id: $id, page: $page) { id } }",
    ]);
  });

  it("stops after five retries, and when Magento names a field already removed", async () => {
    const fields = Array.from({ length: 8 }, (_, i) => `f${i}`);
    const document = `query Many { storeConfig { store_code ${fields.join(" ")} } }`;
    const many = build((call) => {
      const next = fields.find((f) => call.request?.query.includes(` ${f}`) === true);
      return next !== undefined ? gqlErrors([`Cannot query field "${next}" on type "StoreConfig".`]) : undefined;
    }, gqlErrors(["introspection disabled"]));
    await expect(many.client.query(document, { adapt: true })).rejects.toMatchObject({ kind: "invalid-request", message: expect.stringMatching(/f5/) });
    expect(many.sent()).toHaveLength(6);

    const again = build(() => gqlErrors(['Cannot query field "is_virtual" on type "Cart".']), gqlErrors(["introspection disabled"]));
    await expect(again.client.query(GET_CART, { adapt: true })).rejects.toMatchObject({ kind: "invalid-request" });
    expect(again.sent()).toHaveLength(2);
  });

  it("never retries a mutation, and reports Magento's error", async () => {
    const { client, sent } = build(() => gqlErrors(['Cannot query field "gift" on type "Cart".']), gqlErrors(["introspection disabled"]));
    await expect(client.mutate(APPLY, { adapt: true, variables: { id: "AbC123xyz" } })).rejects.toMatchObject({ kind: "invalid-request", message: expect.stringMatching(/gift/) });
    expect(sent()).toHaveLength(1);
  });

  it("reports an operation missing from the root type as unsupported, without retrying", async () => {
    const { client, sent } = build(() => gqlErrors(['Cannot query field "company" on type "Query".']), gqlErrors(["introspection disabled"]));
    await expect(client.query("query Q { company { id } }", { adapt: true })).rejects.toMatchObject({ kind: "unsupported-operation" });
    expect(sent()).toHaveLength(1);
  });
});

describe("the schema listener", () => {
  it("throwing does not leave the call pending: the schema is still answered", async () => {
    const source = createSchemaSource(async () => ({ data: introspectionOf(STORE) }), () => {
      throw new Error("listener");
    });
    await expect(source()).resolves.toBeDefined();
    await expect(source(new AbortController().signal)).resolves.toBeDefined();
  });
});

describe("a value the caller gave that the store cannot take", () => {
  it("is reported in `dropped`, naming the variable", async () => {
    const { client } = build(() => undefined);
    const result = await client.query(GET_CART, { adapt: true, variables: { id: "AbC123xyz", page: 2 } });
    expect(result.dropped).toEqual(["page"]);
  });

  it("is not reported when the caller did not give it", async () => {
    const { client } = build(() => undefined);
    const result = await client.query(GET_CART, { adapt: true, variables: { id: "AbC123xyz" } });
    expect(result.dropped).toBeUndefined();
  });

  it("is reported too when the store's schema could not be read and a field was removed on retry", async () => {
    const DOC = "query Q($id: String!, $n: Int) { cart(cart_id: $id) { id gift(n: $n) { x } } }";
    const { client } = build((call) => (call.request?.query === DOC ? gqlErrors(['Cannot query field "gift" on type "Cart".']) : undefined), json(503, {}));
    const result = await client.query(DOC, { adapt: true, variables: { id: "AbC123xyz", n: 3 } });
    expect(result.dropped).toEqual(["n"]);
  });
});

describe("a caller that cancels while the schema is being read", () => {
  it("is answered as cancelled, and the other callers still get the schema", async () => {
    let finish: (value: { data: unknown }) => void = () => undefined;
    const source = createSchemaSource(() => new Promise((resolve) => { finish = resolve; }));
    const leaving = new AbortController();
    const cancelled = source(leaving.signal);
    const staying = source(new AbortController().signal);
    leaving.abort();
    await expect(cancelled).rejects.toMatchObject({ kind: "transport", message: expect.stringMatching(/cancelled/) });
    finish({ data: introspectionOf(STORE) });
    await expect(staying).resolves.toBeDefined();
  });
});
