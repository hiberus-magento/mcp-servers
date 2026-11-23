// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Every failed call answers with a typed error a host can act on (Kora contract R-8): a code, and the member that
// code needs (the missing ACL resource, how long to wait, the HTTP status, the argument at fault), next to the prose
// an agent reads.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { classifyFailure, MagentoRestError } from "../client/index.js";
import { SqlGuardError } from "../db/sql-guard.js";
import { DEFAULT_RETRY_AFTER_MS, errorBodyFor, invokeErrorBody, ToolArgumentError } from "./tool-error.js";
import { toErrorResult } from "./runtime.js";

const aclBody = (resources: string) => JSON.stringify({ message: "The consumer isn't authorized to access %resources.", parameters: { resources } });

describe("errorBodyFor", () => {
  it("a 401 naming an ACL resource is permission_missing with the resource", () => {
    expect(errorBodyFor(classifyFailure(401, aclBody("Magento_Sales::actions_view")))).toMatchObject({ code: "permission_missing", resource: "Magento_Sales::actions_view", http_status: 401 });
  });

  it("a 403 naming an ACL resource is permission_missing too", () => {
    expect(errorBodyFor(classifyFailure(403, aclBody("Magento_Catalog::products")))).toMatchObject({ code: "permission_missing", resource: "Magento_Catalog::products", http_status: 403 });
  });

  it("a 401 naming no resource is unauthorized", () => {
    expect(errorBodyFor(classifyFailure(401, JSON.stringify({ message: "The consumer isn't authorized to access %resources." })))).toMatchObject({ code: "unauthorized" });
  });

  it("a 429 is rate_limited with the Retry-After it carried, or the documented default", () => {
    expect(errorBodyFor(classifyFailure(429, "", 7000))).toMatchObject({ code: "rate_limited", retry_after_ms: 7000 });
    expect(errorBodyFor(classifyFailure(429, ""))).toMatchObject({ code: "rate_limited", retry_after_ms: DEFAULT_RETRY_AFTER_MS });
  });

  it("a request that timed out is timeout; one that failed in transit, or a 5xx, is unavailable", () => {
    expect(errorBodyFor(new MagentoRestError({ kind: "transport", message: "timed out", retryable: true, timedOut: true }))).toMatchObject({ code: "timeout" });
    expect(errorBodyFor(new MagentoRestError({ kind: "transport", message: "failed", retryable: true }))).toEqual({ code: "unavailable", message: "failed" });
    expect(errorBodyFor(classifyFailure(503, ""))).toMatchObject({ code: "unavailable", http_status: 503 });
  });

  it("a redirect is invalid_argument on MAGENTO_REST_BASE_URL: the base URL is what has to change", () => {
    expect(errorBodyFor(new MagentoRestError({ kind: "redirected", message: "redirected", status: 301 }))).toMatchObject({ code: "invalid_argument", argument: "MAGENTO_REST_BASE_URL", http_status: 301 });
  });

  it("any other Magento failure is upstream_error with its HTTP status", () => {
    expect(errorBodyFor(classifyFailure(400, JSON.stringify({ message: "Invalid value" })))).toMatchObject({ code: "upstream_error", http_status: 400 });
    expect(errorBodyFor(classifyFailure(404, JSON.stringify({ message: "No such entity." })))).toMatchObject({ code: "upstream_error", http_status: 404 });
  });

  it("an argument the server rejects is invalid_argument naming it; a record a write needs is not_found naming it", () => {
    expect(errorBodyFor(new ToolArgumentError("invalid_argument", "store_view", "A write needs a store view."))).toEqual({ code: "invalid_argument", argument: "store_view", message: "A write needs a store view." });
    expect(errorBodyFor(new ToolArgumentError("not_found", "sku", "No product."))).toEqual({ code: "not_found", argument: "sku", message: "No product." });
  });

  it("an argument that fails its schema is invalid_argument naming the first one at fault", () => {
    const parsed = z.object({ sku: z.string().min(1) }).safeParse({ sku: "" });
    expect(parsed.success).toBe(false);
    expect(errorBodyFor(parsed.error)).toMatchObject({ code: "invalid_argument", argument: "sku" });
  });

  it("an input the schema does not know is invalid_argument naming that input", () => {
    const top = z.object({ status: z.string().optional() }).strict().safeParse({ customer_email: "x" });
    const nested = z.object({ sort: z.object({ field: z.string() }).strict() }).strict().safeParse({ sort: { field: "a", path: "/x" } });
    expect(top.success || nested.success).toBe(false);
    if (!top.success) expect(errorBodyFor(top.error)).toMatchObject({ code: "invalid_argument", argument: "customer_email" });
    if (!nested.success) expect(errorBodyFor(nested.error)).toMatchObject({ code: "invalid_argument", argument: "sort.path" });
    const long = z.object({}).strict().safeParse({ ["k".repeat(500)]: 1 });
    if (!long.success) expect(errorBodyFor(long.error).argument).toBe("k".repeat(64));
  });

  it("a refused SQL statement is invalid_argument on the sql argument", () => {
    expect(errorBodyFor(new SqlGuardError("Only SELECT is allowed."))).toMatchObject({ code: "invalid_argument", argument: "sql" });
  });
});

describe("toErrorResult", () => {
  it("carries the typed error as structuredContent next to the prose, remedy included", () => {
    const result = toErrorResult(classifyFailure(401, aclBody("Magento_Sales::actions_view")));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: "permission_missing", resource: "Magento_Sales::actions_view", http_status: 401 } });
    expect(result.content[0]?.text).toContain("Remedy:");
    expect(result.structuredContent.error.message).toBe(result.content[0]?.text);
  });
});

describe("invokeErrorBody", () => {
  const tool = (shape: Record<string, unknown>) => ({ inputSchema: { shape } });

  it("an error result invoke gives without a known kind is upstream_error, never unauthorized", () => {
    expect(invokeErrorBody({ content: [{ text: "something else" }] }, tool({}))).toEqual({ code: "upstream_error", message: "something else" });
  });

  it("a missing credential is unauthorized, carrying the remedy text", () => {
    expect(invokeErrorBody({ content: [{ text: "Missing credential for domain magento-rest." }], errorKind: "credential" }, tool({}))).toEqual({ code: "unauthorized", message: "Missing credential for domain magento-rest." });
  });

  it("a result over the cap is invalid_argument on the tool's size argument, or on arguments when it has none", () => {
    expect(invokeErrorBody({ content: [{ text: "too large" }], errorKind: "too_large" }, tool({ sku: 1, page_size: 1 }))).toMatchObject({ code: "invalid_argument", argument: "page_size" });
    expect(invokeErrorBody({ content: [{ text: "too large" }], errorKind: "too_large" }, tool({ email: 1, max_pages: 1 }))).toMatchObject({ code: "invalid_argument", argument: "max_pages" });
    expect(invokeErrorBody({ content: [{ text: "too large" }], errorKind: "too_large" }, tool({ sku: 1 }))).toMatchObject({ code: "invalid_argument", argument: "arguments" });
  });
});
