// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 3.2): `mapThrottle` is the sole construction site for
// both throttle error classes (design.md, Decision 3). These three
// assertions are the standing proof that a raw 429 (Admin API) and a 503
// with `x-error` containing `"(429)"` (content source) can never be
// confused with each other or with an ordinary 503.
import { describe, expect, it } from "vitest";
import { AdminRateLimitError, ContentSourceThrottledError, UpstreamUnavailableError } from "./errors.js";
import { mapThrottle } from "./http.js";

describe("mapThrottle", () => {
  it("maps a raw 429 to AdminRateLimitError, never to ContentSourceThrottledError", () => {
    const error = mapThrottle(429, new Headers());

    expect(error).toBeInstanceOf(AdminRateLimitError);
    expect(error).not.toBeInstanceOf(ContentSourceThrottledError);
    expect(error?.kind).toBe("admin-rate-limited");
  });

  it("maps a 503 with x-error containing (429) to ContentSourceThrottledError, never to AdminRateLimitError", () => {
    const headers = new Headers({ "x-error": "Bulk update failed (429): content source throttled" });

    const error = mapThrottle(503, headers);

    expect(error).toBeInstanceOf(ContentSourceThrottledError);
    expect(error).not.toBeInstanceOf(AdminRateLimitError);
    expect(error?.kind).toBe("content-source-throttled");
  });

  it("maps a 503 without (429) in x-error to neither throttle class", () => {
    const headers = new Headers({ "x-error": "Bulk update failed: internal error" });

    const error = mapThrottle(503, headers);

    expect(error).toBeUndefined();
    expect(error).not.toBeInstanceOf(AdminRateLimitError);
    expect(error).not.toBeInstanceOf(ContentSourceThrottledError);
  });

  it("the two throttle kinds are structurally distinct discriminants (never equal)", () => {
    const admin = mapThrottle(429, new Headers());
    const contentSource = mapThrottle(503, new Headers({ "x-error": "(429)" }));

    expect(admin?.kind).not.toBe(contentSource?.kind);
  });
});

describe("http client boundary", () => {
  it("attaches X-Auth-Token using the caller-supplied token, never process.env", async () => {
    const { createHttpClient } = await import("./http.js");
    const calls: Array<{ headers: Headers }> = [];
    const deps = {
      fetch: (async (_input: unknown, init?: RequestInit) => {
        calls.push({ headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({}), { status: 200 });
      }) as typeof globalThis.fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      tokenProvider: {
        domain: "eds",
        getToken: async () => ({ kind: "static" as const, value: "test-only-key-value" }),
        invalidate: () => undefined,
        describeRemedy: () => ({
          domain: "eds",
          cliCommand: "hiberus-eds auth token set",
          envVar: "EDS_TOKEN",
          configPath: "/dev/null",
          reason: "not found",
        }),
      },
      baseUrl: "https://admin.hlx.page",
      org: "acme-demo-org",
    };

    const client = createHttpClient(deps);
    await client.send({ method: "GET", path: "/status/acme-demo-org/acme-demo-site-eu/main/" });

    expect(calls[0]?.headers.get("X-Auth-Token")).toBe("test-only-key-value");
    expect(calls[0]?.headers.get("Authorization")).toBeNull();
  });

  it("propagates AdminRateLimitError instead of returning a response, on 429", async () => {
    const { createHttpClient } = await import("./http.js");
    const deps = {
      fetch: (async () => new Response(null, { status: 429 })) as typeof globalThis.fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      tokenProvider: {
        domain: "eds",
        getToken: async () => ({ kind: "static" as const, value: "k" }),
        invalidate: () => undefined,
        describeRemedy: () => ({
          domain: "eds",
          cliCommand: "hiberus-eds auth token set",
          envVar: "EDS_TOKEN",
          configPath: "/dev/null",
          reason: "not found",
        }),
      },
      baseUrl: "https://admin.hlx.page",
      org: "acme-demo-org",
    };

    const client = createHttpClient(deps);

    await expect(client.send({ method: "GET", path: "/status/acme-demo-org/acme-demo-site-eu/main/" })).rejects.toBeInstanceOf(
      AdminRateLimitError,
    );
  });

  it("propagates UpstreamUnavailableError on a plain 503 with no throttle signature", async () => {
    const { createHttpClient } = await import("./http.js");
    const deps = {
      fetch: (async () => new Response(null, { status: 503, headers: { "x-error": "internal error" } })) as typeof globalThis.fetch,
      now: () => Date.now(),
      sleep: async () => undefined,
      tokenProvider: {
        domain: "eds",
        getToken: async () => ({ kind: "static" as const, value: "k" }),
        invalidate: () => undefined,
        describeRemedy: () => ({
          domain: "eds",
          cliCommand: "hiberus-eds auth token set",
          envVar: "EDS_TOKEN",
          configPath: "/dev/null",
          reason: "not found",
        }),
      },
      baseUrl: "https://admin.hlx.page",
      org: "acme-demo-org",
    };

    const client = createHttpClient(deps);

    await expect(client.send({ method: "GET", path: "/status/acme-demo-org/acme-demo-site-eu/main/" })).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });
});
