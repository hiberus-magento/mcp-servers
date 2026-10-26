// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { createFetchDouble, json } from "./fetch-double.js";

describe("createFetchDouble", () => {
  it("matches an exact `METHOD pathname?search` route before a pathname-only one", async () => {
    const double = createFetchDouble({
      "GET /rest/V1/products?a=1": json(200, { exact: true }),
      "GET /rest/V1/products": json(200, { exact: false }),
    });
    const exact = await double.fetch("https://demo-host.example-domain/rest/V1/products?a=1");
    const loose = await double.fetch("https://demo-host.example-domain/rest/V1/products?a=2");
    expect(await exact.json()).toEqual({ exact: true });
    expect(await loose.json()).toEqual({ exact: false });
  });

  it("plays an array of responses in order and repeats the last", async () => {
    const double = createFetchDouble({ "GET /x": [json(503, { message: "busy" }), json(200, { ok: 1 })] });
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await double.fetch("https://demo-host.example-domain/x")).status);
    }
    expect(statuses).toEqual([503, 200, 200]);
  });

  it("records method, url, headers and body for every call", async () => {
    const double = createFetchDouble({ "POST /x": json(200, {}) });
    await double.fetch("https://demo-host.example-domain/x", { method: "POST", headers: { Authorization: "Bearer t" }, body: '{"a":1}' });
    expect(double.calls).toEqual([
      { method: "POST", url: "https://demo-host.example-domain/x", headers: { authorization: "Bearer t" }, body: '{"a":1}' },
    ]);
  });

  it("throws, naming the key, for an unregistered route", async () => {
    const double = createFetchDouble({});
    await expect(double.fetch("https://demo-host.example-domain/nope")).rejects.toThrow('no route registered for "GET /nope"');
  });

  it("supports a handler function and a rejecting network failure", async () => {
    const double = createFetchDouble({ "GET /h": (call) => json(200, { method: call.method }), "GET /down": () => { throw new TypeError("fetch failed"); } });
    expect(await (await double.fetch("https://demo-host.example-domain/h")).json()).toEqual({ method: "GET" });
    await expect(double.fetch("https://demo-host.example-domain/down")).rejects.toThrow("fetch failed");
  });
});
