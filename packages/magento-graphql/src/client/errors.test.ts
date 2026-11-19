// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. A GraphQL failure arrives two ways: an HTTP status (proxy, WAF, rate limit) and
// HTTP 200 with an `errors` array. Both must become one classified error that keeps Magento's
// message and nothing else — no `extensions`, `locations`, `path`, no non-JSON body.
import { describe, expect, it } from "vitest";
import { MagentoGraphqlError, classifyGraphqlErrors, classifyHttpFailure } from "./errors.js";

describe("classifyHttpFailure", () => {
  it.each([
    [401, "unauthorized", false],
    [403, "forbidden", false],
    [404, "not-found", false],
    [400, "invalid-request", false],
    [429, "rate-limited", true],
    [500, "server", false],
    [502, "server", true],
    [503, "server", true],
    [504, "server", true],
  ] as const)("status %i -> %s (retryable: %s)", (status, kind, retryable) => {
    const error = classifyHttpFailure(status, "");
    expect(error).toBeInstanceOf(MagentoGraphqlError);
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
  });

  it("gives a 403 a remedy that points at what is in front of Magento and at the customer token", () => {
    const error = classifyHttpFailure(403, "");
    expect(error.kind).toBe("forbidden");
    expect(error.remedy).toMatch(/firewall|WAF/);
    expect(error.remedy).toContain("customer token");
  });

  it("never carries a non-JSON body (an HTML error page)", () => {
    const error = classifyHttpFailure(502, "<html>Bad gateway for secret-internal-host</html>");
    expect(error.message).toBe("Magento GraphQL request failed with HTTP 502.");
  });

  it("keeps a JSON `message` (Magento's REST-style error) and redacts credentials in it", () => {
    const error = classifyHttpFailure(400, JSON.stringify({ message: "Rejected Authorization: Bearer demo-bearer-99" }));
    expect(error.message).toContain("HTTP 400");
    expect(error.message).not.toContain("demo-bearer-99");
  });
});

describe("classifyGraphqlErrors", () => {
  it("joins the messages and drops extensions, locations and path", () => {
    const error = classifyGraphqlErrors([
      { message: "Field \"nope\" is not defined.", extensions: { category: "graphql", secret: "xyz" }, locations: [{ line: 1, column: 2 }], path: ["a", "b"] },
    ]);
    expect(error.kind).toBe("invalid-request");
    expect(error.message).toContain('Field "nope" is not defined.');
    expect(JSON.stringify(error)).not.toContain("xyz");
    expect(error.message).not.toContain("locations");
  });

  it.each(["graphql-authorization", "graphql-authentication"])("maps category %s to unauthorized, with a remedy naming the token", (category) => {
    const error = classifyGraphqlErrors([{ message: "The current customer isn't authorized.", extensions: { category } }]);
    expect(error.kind).toBe("unauthorized");
    expect(error.remedy).toContain("MAGENTO_GRAPHQL_TOKEN");
    expect(error.remedy).toContain("auth token set");
  });

  it("maps graphql-no-such-entity to not-found", () => {
    expect(classifyGraphqlErrors([{ message: "x", extensions: { category: "graphql-no-such-entity" } }]).kind).toBe("not-found");
  });

  it("maps an unknown category to a plain request error", () => {
    expect(classifyGraphqlErrors([{ message: "boom", extensions: { category: "internal" } }]).kind).toBe("invalid-request");
  });

  it("caps the number and the length of messages, and redacts credentials", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ message: `problem ${i} ${"x".repeat(600)} Bearer demo-bearer-99` }));
    const error = classifyGraphqlErrors(many);
    expect(error.message.length).toBeLessThan(1500);
    expect(error.message).not.toContain("demo-bearer-99");
  });

  it("tolerates entries that are not shaped like errors", () => {
    expect(classifyGraphqlErrors([null, 3, { nope: true }]).message).toContain("Magento GraphQL");
  });
});
