// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first: the original logged and returned `error.response.data` wholesale.
// Magento puts the offending VALUES (an email, an order id) in the body's
// `parameters`, so a failure message was a PII leak. `classifyFailure` keeps
// only Magento's message TEMPLATE (which holds `%1`-style placeholders, never
// the values) and never the raw body.
import { describe, expect, it } from "vitest";
import { MagentoRestError, classifyFailure } from "./errors.js";

const body = (value: unknown): string => JSON.stringify(value);

describe("classifyFailure", () => {
  it.each([
    [401, "unauthorized", false],
    [403, "forbidden", false],
    [404, "not-found", false],
    [400, "invalid-request", false],
    [422, "invalid-request", false],
    [429, "rate-limited", true],
    [500, "server", false],
    [502, "server", true],
    [503, "server", true],
    [504, "server", true],
  ] as const)("status %i -> %s (retryable: %s)", (status, kind, retryable) => {
    const error = classifyFailure(status, body({ message: "Something happened." }));
    expect(error).toBeInstanceOf(MagentoRestError);
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(retryable);
  });

  it("keeps Magento's message template", () => {
    expect(classifyFailure(404, body({ message: "The product that was requested doesn't exist." })).message).toContain("doesn't exist");
  });

  it("never carries the parameters, which hold the offending values", () => {
    const error = classifyFailure(
      404,
      body({ message: "No such entity with %fieldName = %fieldValue", parameters: { fieldName: "email", fieldValue: "shopper@example-domain" } }),
    );
    expect(error.message).toContain("%fieldValue");
    expect(error.message).not.toContain("shopper@example-domain");
  });

  it("never carries a non-JSON body (an HTML error page)", () => {
    const error = classifyFailure(502, "<html><body>Bad gateway for secret-internal-host</body></html>");
    expect(error.message).toBe("Magento REST request failed with HTTP 502.");
    expect(error.message).not.toContain("secret-internal-host");
  });

  it("redacts a credential-shaped value inside Magento's own message", () => {
    const error = classifyFailure(400, body({ message: "Rejected Authorization: Bearer demo-bearer-99" }));
    expect(error.message).not.toContain("demo-bearer-99");
  });

  it("truncates a very long message", () => {
    expect(classifyFailure(400, body({ message: "x".repeat(5000) })).message.length).toBeLessThan(400);
  });

  describe("the ACL resource Magento names, which is configuration and not customer data", () => {
    const acl = (status: number, resources: unknown) =>
      classifyFailure(status, JSON.stringify({ message: "The consumer isn't authorized to access %resources.", parameters: { resources } }));

    it("is kept on a 401, where Magento reports BOTH a bad token and a missing permission", () => {
      expect(acl(401, "Magento_Backend::store").message).toContain("Magento_Backend::store");
    });

    it("is kept on a 403 too", () => {
      expect(acl(403, "Magento_Catalog::products").message).toContain("Magento_Catalog::products");
    });

    it("keeps several resources, as Magento joins them", () => {
      expect(acl(401, "Magento_Sales::sales, Magento_Customer::customer").message).toContain("Magento_Sales::sales, Magento_Customer::customer");
    });

    it.each([["a string with a newline and markup", "x\n<script>alert(1)</script>"], ["a path", "../../etc/passwd"], ["an email", "shopper@demo-host.example"], ["a number", 42], ["an object", { a: 1 }], ["an over-long list", `Magento_A::${"b".repeat(300)}`]])(
      "is NOT kept when it is %s — only a closed shape of ACL ids is",
      (_name, value) => {
        const message = acl(401, value).message;
        expect(message).not.toContain("script");
        expect(message).not.toContain("passwd");
        expect(message).not.toContain("shopper@");
        expect(message).not.toContain("bbbbbbbbbb");
      },
    );

    it("is never taken from any other status, so the 404 rule still holds", () => {
      const error = classifyFailure(404, JSON.stringify({ message: "No such entity.", parameters: { resources: "Magento_Backend::store" } }));
      expect(error.message).not.toContain("Magento_Backend::store");
    });
  });

  it("tells a 401 apart from what it can mean: a bad token, an inactive integration, or a missing resource", () => {
    const remedy = classifyFailure(401, JSON.stringify({ message: "x" })).remedy ?? "";
    expect(remedy).toMatch(/Active/);
    expect(remedy).toMatch(/Access Token/);
    expect(remedy).toMatch(/Consumer Key/);
    expect(remedy).toMatch(/resource/i);
    // Found against a live 2.4.8-p5: with this setting off, a correct token for an Active
    // integration with every permission is still answered 401.
    expect(remedy).toMatch(/standalone Bearer/i);
  });

  // Found against a live 2.4.8: of 150 carts, ONE references something that no longer exists;
  // any page of /carts/search that includes it fails with `404 No such entity with
  // %fieldName = %fieldValue`, while a page_size of 1 on every other position succeeds. To a
  // caller that reads as "the thing I asked for does not exist", which is the wrong lesson.
  it("explains that a 404 on a LIST can mean one record in the page is broken, and how to get past it", () => {
    const remedy = classifyFailure(404, JSON.stringify({ message: "No such entity with %fieldName = %fieldValue" })).remedy ?? "";
    expect(remedy).toMatch(/list/i);
    expect(remedy).toMatch(/page_size/);
    expect(remedy).toMatch(/narrower|filter/i);
  });

  it("gives no remedy for the failures that need none", () => {
    expect(classifyFailure(400, JSON.stringify({ message: "x" })).remedy).toBeUndefined();
    expect(classifyFailure(500, JSON.stringify({ message: "x" })).remedy).toBeUndefined();
  });

  it("names a remedy for the two credential failures", () => {
    expect(classifyFailure(401, body({ message: "x" })).remedy).toMatch(/token/i);
    expect(classifyFailure(403, body({ message: "x" })).remedy).toMatch(/resource|role|permission/i);
  });
});
