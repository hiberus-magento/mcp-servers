// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. Every `magentorest_*` tool is built through this factory, so the
// guarantees live here once: strict inputs, a REQUIRED output shape, and
// annotations derived from the kind of effect rather than typed by hand a
// hundred times (where one wrong `readOnlyHint` is an agent running a write
// without a confirmation prompt).
import { describe, expect, it, vi } from "vitest";
import { z, ZodError } from "zod";
import type { MagentoRestClient } from "../client/index.js";
import { createToolFactory } from "./rest-tool.js";
import { NOTHING_REPORTED_NOTICE } from "./rest-tool.js";
import { UNVERIFIED_DETAIL, UNVERIFIED_MARKER } from "./verification.js";

// `with` returns the same double, so a read tool binding its options (signal, provenance) still talks to it, and
// every `get` reports an answer the way the real transport does.
let answered: ((answer: { endpoint: string; readAt: string }) => void) | undefined;
const answer = (): void => answered?.({ endpoint: "GET /rest/V1/x", readAt: "2026-11-23T10:00:00.000Z" });
const client = {
  get: vi.fn(async () => {
    answer();
    return { id: 1, secret: "leak" };
  }),
  with: (options: { onAnswered?: typeof answered }) => {
    answered = options.onAnswered;
    return client;
  },
} as unknown as MagentoRestClient;
const factory = () => createToolFactory(() => client);

describe("createToolFactory", () => {
  it("does not resolve the client while tools are being defined — only when one is called", async () => {
    const getClient = vi.fn(() => client);
    const { readTool } = createToolFactory(getClient);
    const tool = readTool({ name: "magentorest_probe", description: "Probe.", input: z.object({}).strict(), shape: ["id"], run: (_a, c) => c.get("/x") });
    expect(getClient).not.toHaveBeenCalled();
    await tool.invoke({}, {});
    expect(getClient).toHaveBeenCalledTimes(1);
  });

  it("hands the tool a client bound to the MCP request's signal, so a cancelled call aborts its request", async () => {
    let onAnswered: ((answer: { endpoint: string; readAt: string }) => void) | undefined;
    const bound = {
      get: vi.fn(async () => {
        onAnswered?.({ endpoint: "GET /rest/V1/x", readAt: "2026-11-23T10:00:00.000Z" });
        return { id: 2 };
      }),
    } as unknown as MagentoRestClient;
    const withOptions = vi.fn((options: { onAnswered?: typeof onAnswered }) => {
      onAnswered = options.onAnswered;
      return bound;
    });
    const base = { with: withOptions } as unknown as MagentoRestClient;
    const tool = createToolFactory(() => base).readTool({ name: "magentorest_c", description: "C.", input: z.object({}).strict(), shape: ["id"], run: (_a, c) => c.get("/x") });
    const controller = new AbortController();
    const result = await tool.invoke({}, { signal: controller.signal });
    expect(withOptions).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
    expect(result.structuredContent?.["result"]).toEqual({ id: 2 });
  });

  it("a read tool carries the three read-only annotations and access `read`", () => {
    const tool = factory().readTool({ name: "magentorest_r", description: "R.", input: z.object({}).strict(), shape: ["id"], run: async () => ({}) });
    expect(tool.access).toBe("read");
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
  });

  it.each([
    ["create", false, false],
    ["update", true, true],
    ["delete", true, true],
    ["action", true, false],
  ] as const)("a write tool with effect %s -> destructive %s, idempotent %s, never read-only", (effect, destructive, idempotent) => {
    const tool = factory().writeTool({ name: "magentorest_w", description: "W.", input: z.object({}).strict(), effect, shape: ["id"], run: async () => ({}) });
    expect(tool.access).toBe("write");
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: destructive, idempotentHint: idempotent });
  });

  it("projects the result through the declared shape: an undeclared field never reaches the caller", async () => {
    const tool = factory().readTool({ name: "magentorest_p", description: "P.", input: z.object({}).strict(), shape: ["id"], run: (_a, c) => c.get("/x") });
    const result = await tool.invoke({}, {});
    expect(result.structuredContent?.["result"]).toEqual({ id: 1 });
    expect(result.content[0]?.text).not.toContain("leak");
  });

  it("rejects an unknown argument instead of ignoring it", async () => {
    const tool = factory().readTool({ name: "magentorest_s", description: "S.", input: z.object({ sku: z.string() }).strict(), shape: ["id"], run: async () => ({}) });
    await expect(tool.invoke({ sku: "A", extra: 1 }, {})).rejects.toBeInstanceOf(ZodError);
  });

  describe("verification marker", () => {
    const spec = { name: "magentorest_v", description: "Use this to read a thing.", input: z.object({}).strict(), shape: ["id"], run: async () => ({}) } as const;

    it("appends the marker and detail to the description of a tool not verified live (the default)", () => {
      const tool = factory().readTool(spec);
      expect(tool.description).toBe(`Use this to read a thing. ${UNVERIFIED_MARKER} — ${UNVERIFIED_DETAIL}`);
    });

    it("leaves the description alone for a tool listed as verified live", () => {
      const { readTool } = createToolFactory(() => client, { liveVerified: new Set(["magentorest_v"]) });
      expect(readTool(spec).description).toBe("Use this to read a thing.");
    });

    it("applies to writes too", () => {
      const tool = factory().writeTool({ ...spec, effect: "create" });
      expect(tool.description).toContain(UNVERIFIED_MARKER);
    });
  });

  // Stock Magento answers with the record, but a customised store can answer a write with an acknowledgement that is
  // not one. Projected through the allowlist it would become `[{}]`, which reads as a success that says nothing. When Magento returns something but NONE of it is a field the tool reports, the result says so.
  describe("a response that carries none of the reported fields", () => {
    const outcome = async (response: unknown, shape: readonly string[] = ["id"]) => {
      const tool = factory().writeTool({ name: "magentorest_q", description: "Q.", effect: "create", input: z.object({}).strict(), shape: [...shape], run: async () => response });
      return (await tool.invoke({}, {})).content[0]?.text;
    };

    it("is replaced by a fixed notice instead of `{}`", async () => {
      expect(await outcome({ success: true, message: "queued" })).toBe(NOTHING_REPORTED_NOTICE);
    });

    it("is replaced by the notice when it is a list of such objects, instead of `[{}]`", async () => {
      expect(await outcome([{ success: true, message: "Customer queued successfully" }])).toBe(NOTHING_REPORTED_NOTICE);
    });

    it("never leaks what it replaced", async () => {
      const text = (await outcome([{ success: true, message: "Customer queued successfully", secret_thing: "do-not-leak" }])) ?? "";
      expect(text).not.toContain("queued");
      expect(text).not.toContain("do-not-leak");
    });

    it("says what it means: accepted, nothing reportable, maybe asynchronous, verify with a read", () => {
      expect(NOTHING_REPORTED_NOTICE).toMatch(/accepted/i);
      expect(NOTHING_REPORTED_NOTICE).toMatch(/asynchronous|queued/i);
      expect(NOTHING_REPORTED_NOTICE).toMatch(/read/i);
    });

    it.each([
      ["a boolean", true],
      ["a number", 12],
      ["an empty object", {}],
      ["an empty list", []],
      ["nothing at all", undefined],
      ["null", null],
    ])("leaves %s untouched — there was nothing to hide", async (_name, response) => {
      expect(await outcome(response, [])).not.toBe(NOTHING_REPORTED_NOTICE);
    });

    it("leaves a response that DOES carry a reported field alone", async () => {
      expect(await outcome({ id: 5, extra: "dropped" })).toBe('{"id":5}');
    });

    it("applies to a read too: a record with no reported field is not silently shown as empty", async () => {
      const tool = factory().readTool({ name: "magentorest_q2", description: "Q.", input: z.object({}).strict(), shape: ["id"], run: (_a, c) => c.get("/x") });
      vi.mocked(client.get).mockImplementationOnce(async () => {
        answer();
        return { unknown_field: 1 };
      });
      expect((await tool.invoke({}, {})).structuredContent?.["result"]).toBe(NOTHING_REPORTED_NOTICE);
    });
  });

  it("passes parsed arguments and the lazily resolved client to run", async () => {
    const run = vi.fn<(args: { sku: string }, client: MagentoRestClient) => Promise<unknown>>(async (_args, c) => c.get("/x"));
    const tool = factory().readTool({ name: "magentorest_a", description: "A.", input: z.object({ sku: z.string() }).strict(), shape: ["id"], run });
    await tool.invoke({ sku: "DEMO-TENT-001" }, {});
    expect(run).toHaveBeenCalledWith({ sku: "DEMO-TENT-001" }, client);
  });
});

describe("createToolFactory — structured output and provenance on read tools", () => {
  // A client that reports each answer the way the real transport does.
  function answeringClient(body: unknown, storeView?: string): MagentoRestClient {
    const view = (onAnswered?: (answer: { endpoint: string; readAt: string; storeView?: string }) => void): MagentoRestClient =>
      ({
        get: async (path: string) => {
          onAnswered?.({ endpoint: `GET /rest/V1${path}`, readAt: "2026-11-23T10:00:00.000Z", ...(storeView !== undefined ? { storeView } : {}) });
          return body;
        },
        with: (options: { onAnswered?: typeof onAnswered }) => view(options.onAnswered ?? onAnswered),
      }) as unknown as MagentoRestClient;
    return view();
  }

  const readSpec = { name: "magentorest_s" as const, description: "S.", input: z.object({}).strict(), shape: ["id", ["items", ["sku"]]] as const };

  it("declares an output schema, and returns the projected result with its provenance as structuredContent, mirrored as text", async () => {
    const tool = createToolFactory(() => answeringClient({ id: 1, secret: "leak", items: [{ sku: "DEMO-TENT-001", price: 3 }] })).readTool({ ...readSpec, run: (_a, c) => c.get("/orders") });

    const result = await tool.invoke({}, {});

    expect(tool.outputSchema).toBeDefined();
    expect(result.structuredContent).toEqual({
      result: { id: 1, items: [{ sku: "DEMO-TENT-001" }] },
      provenance: { endpoint: "GET /rest/V1/orders", api_version: "V1", read_at: "2026-11-23T10:00:00.000Z" },
    });
    expect(JSON.parse(result.content[0]?.text ?? "")).toEqual(result.structuredContent);
    expect(tool.outputSchema?.safeParse(result.structuredContent).success).toBe(true);
  });

  it("names the store view when the request addressed one, and every endpoint when the tool made several requests", async () => {
    const tool = createToolFactory(() => answeringClient({ id: 1 }, "demo_view")).readTool({
      ...readSpec,
      run: async (_a, c) => {
        await c.get("/store/storeViews");
        return c.get("/orders");
      },
    });

    const { structuredContent } = await tool.invoke({}, {});

    expect(structuredContent?.["provenance"]).toEqual({
      endpoint: "GET /rest/V1/store/storeViews",
      endpoints: ["GET /rest/V1/store/storeViews", "GET /rest/V1/orders"],
      api_version: "V1",
      read_at: "2026-11-23T10:00:00.000Z",
      store_view: "demo_view",
    });
  });

  it("accepts every result shape a read can produce: an object, a list, an empty answer and the nothing-reported notice", async () => {
    for (const body of [{ id: 1 }, [{ id: 1 }, { id: 2 }], undefined, { other: true }]) {
      const tool = createToolFactory(() => answeringClient(body)).readTool({ ...readSpec, run: (_a, c) => c.get("/x") });
      const { structuredContent } = await tool.invoke({}, {});
      expect(tool.outputSchema?.safeParse(structuredContent).success).toBe(true);
    }
  });

  it("refuses to answer a read that produced no Magento answer, rather than inventing where the data came from", async () => {
    const tool = createToolFactory(() => answeringClient({ id: 1 })).readTool({ ...readSpec, run: async () => ({ id: 1 }) });
    await expect(tool.invoke({}, {})).rejects.toThrow(/no Magento answer/);
  });

  it("lists each distinct endpoint once, in order, when the same path was paged through", async () => {
    const tool = createToolFactory(() => answeringClient({ id: 1 })).readTool({
      ...readSpec,
      run: async (_a, c) => {
        await c.get("/orders");
        await c.get("/orders");
        return c.get("/orders/1/comments");
      },
    });
    const { structuredContent } = await tool.invoke({}, {});
    expect(structuredContent?.["provenance"]).toMatchObject({ endpoint: "GET /rest/V1/orders", endpoints: ["GET /rest/V1/orders", "GET /rest/V1/orders/1/comments"] });
  });

  it("produces the same output schema every time, as a JSON Schema object", () => {
    const make = () => createToolFactory(() => answeringClient({})).readTool({ ...readSpec, run: (_a, c) => c.get("/x") });
    const first = z.toJSONSchema(make().outputSchema ?? z.object({}));
    expect(first).toMatchObject({ type: "object" });
    expect(JSON.stringify(z.toJSONSchema(make().outputSchema ?? z.object({})))).toBe(JSON.stringify(first));
  });

  it("a write tool declares no output schema and returns no structuredContent", async () => {
    const tool = createToolFactory(() => answeringClient({ id: 1 })).writeTool({ ...readSpec, effect: "update", run: (_a, c) => c.get("/x") });
    const result = await tool.invoke({}, {});
    expect(tool.outputSchema).toBeUndefined();
    expect(result.structuredContent).toBeUndefined();
  });
});
