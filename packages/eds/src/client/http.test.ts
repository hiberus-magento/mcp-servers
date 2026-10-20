// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 3.2): `mapThrottle` is the sole construction site for
// both throttle error classes (design.md, Decision 3). These three
// assertions are the standing proof that a raw 429 (Admin API) and a 503
// with `x-error` containing `"(429)"` (content source) can never be
// confused with each other or with an ordinary 503.
import { describe, expect, it } from "vitest";
import {
  AdminApiAuthError,
  AdminApiStatusError,
  AdminRateLimitError,
  ContentSourceThrottledError,
  GatewayError,
  UpstreamUnavailableError,
} from "./errors.js";
import { createHttpClient, mapThrottle } from "./http.js";

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

// RED-first: `send()` classified 429, 502/504 and 503 and then RETURNED the
// failing response anyway, so every other non-ok status (400, 401, 403,
// 404, 500) reached the caller as a plain `Response` that was immediately
// `.json()`-ed. Against the real Admin API a 400 on the CDN config
// document, a 403 on bulk status and a failed publish all arrive with a
// ZERO-BYTE body, so the operator saw `Unexpected end of JSON input`
// instead of the status. These tests hand `send()` exactly that input.
const SYNTHETIC_CREDENTIAL = "test-only-secret-value";

function makeClient(fetchImpl: typeof globalThis.fetch) {
  return createHttpClient({
    fetch: fetchImpl,
    now: () => Date.now(),
    sleep: async () => undefined,
    tokenProvider: {
      domain: "eds",
      getToken: async () => ({ kind: "static" as const, value: SYNTHETIC_CREDENTIAL }),
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
  });
}

function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
}

const EMPTY_BODY_STATUSES = [400, 404, 500] as const;

describe("unclassified non-ok statuses", () => {
  for (const status of EMPTY_BODY_STATUSES) {
    it(`throws AdminApiStatusError naming the status on a ${status} with a zero-byte body`, async () => {
      const client = makeClient((async () => new Response(null, { status })) as typeof globalThis.fetch);

      const error = await rejection(client.send({ method: "GET", path: "/config/acme-demo-org/sites/acme-demo-site-eu/cdn/config.json" }));

      expect(error).toBeInstanceOf(AdminApiStatusError);
      expect((error as AdminApiStatusError).status).toBe(status);
      expect((error as AdminApiStatusError).message).toContain(String(status));
      expect((error as AdminApiStatusError).message).toContain("GET");
      expect((error as AdminApiStatusError).message).toContain("/cdn/config.json");
      expect((error as AdminApiStatusError).message).not.toContain("JSON input");
    });
  }

  it("never returns an unclassified non-ok response to the caller", async () => {
    const client = makeClient((async () => new Response(null, { status: 400 })) as typeof globalThis.fetch);

    await expect(client.send({ method: "GET", path: "/config/acme-demo-org.json" })).rejects.toBeInstanceOf(AdminApiStatusError);
  });

  it("names the request's purpose when the caller supplies a label", async () => {
    const client = makeClient((async () => new Response(null, { status: 400 })) as typeof globalThis.fetch);

    const error = await rejection(
      client.send({ method: "GET", path: "/config/acme-demo-org/sites/acme-demo-site-eu/cdn/config.json", label: "the CDN config" }),
    );

    expect((error as AdminApiStatusError).message).toContain("the CDN config");
  });

  it("carries what the body says when it says anything", async () => {
    const client = makeClient(
      (async () =>
        new Response("path does not exist in preview", { status: 400, headers: { "content-type": "text/plain" } })) as typeof globalThis.fetch,
    );

    const error = await rejection(client.send({ method: "POST", path: "/live/acme-demo-org/acme-demo-site-eu/main/*" }));

    expect((error as AdminApiStatusError).detail).toBe("path does not exist in preview");
    expect((error as AdminApiStatusError).message).toContain("path does not exist in preview");
  });

  it("bounds the body excerpt instead of inlining a megabyte of HTML", async () => {
    const huge = "<html>".padEnd(200_000, "x");
    const client = makeClient((async () => new Response(huge, { status: 500 })) as typeof globalThis.fetch);

    const error = await rejection(client.send({ method: "GET", path: "/config/acme-demo-org.json" }));

    expect((error as AdminApiStatusError).detail?.length).toBeLessThan(1000);
    expect((error as AdminApiStatusError).message.length).toBeLessThan(2000);
  });

  it("falls back to the x-error header when the body is empty", async () => {
    const client = makeClient(
      (async () => new Response(null, { status: 400, headers: { "x-error": "invalid cdn configuration" } })) as typeof globalThis.fetch,
    );

    const error = await rejection(client.send({ method: "GET", path: "/config/acme-demo-org.json" }));

    expect((error as AdminApiStatusError).detail).toBe("invalid cdn configuration");
  });

  it("returns a non-ok response the caller explicitly expects, instead of throwing", async () => {
    const client = makeClient((async () => new Response(null, { status: 404 })) as typeof globalThis.fetch);

    const response = await client.send({ method: "GET", path: "/config/acme-demo-org/sites/acme-demo-site-eu.json", expectedStatuses: [404] });

    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
  });

  it("never lets expectedStatuses suppress a throttle signal", async () => {
    const client = makeClient((async () => new Response(null, { status: 429 })) as typeof globalThis.fetch);

    await expect(client.send({ method: "GET", path: "/config/acme-demo-org.json", expectedStatuses: [429] })).rejects.toBeInstanceOf(
      AdminRateLimitError,
    );
  });
});

describe("authentication and permission statuses", () => {
  it("throws AdminApiAuthError on a 401 with a zero-byte body, naming the credential and how to set it", async () => {
    const client = makeClient((async () => new Response(null, { status: 401 })) as typeof globalThis.fetch);

    const error = await rejection(client.send({ method: "GET", path: "/config/acme-demo-org.json" }));

    expect(error).toBeInstanceOf(AdminApiAuthError);
    expect((error as AdminApiAuthError).status).toBe(401);
    expect((error as AdminApiAuthError).message).toContain("401");
    expect((error as AdminApiAuthError).message).toContain("hiberus-eds auth token set");
    expect((error as AdminApiAuthError).message).toContain("EDS_TOKEN");
    expect((error as AdminApiAuthError).message).not.toContain("JSON input");
  });

  it("throws AdminApiAuthError on a 403 with a zero-byte body, naming the permission as the cause", async () => {
    const client = makeClient((async () => new Response(null, { status: 403 })) as typeof globalThis.fetch);

    const error = await rejection(client.send({ method: "POST", path: "/status/acme-demo-org/acme-demo-site-eu/main/*" }));

    expect(error).toBeInstanceOf(AdminApiAuthError);
    expect((error as AdminApiAuthError).status).toBe(403);
    expect((error as AdminApiAuthError).message).toContain("403");
    expect((error as AdminApiAuthError).message).toContain("permission");
    expect((error as AdminApiAuthError).message).toContain("/status/acme-demo-org/acme-demo-site-eu/main/*");
  });

  it("never leaks the token value into the message", async () => {
    const client = makeClient((async () => new Response(null, { status: 403 })) as typeof globalThis.fetch);

    const error = await rejection(client.send({ method: "GET", path: "/config/acme-demo-org.json" }));

    expect((error as AdminApiAuthError).message).not.toContain(SYNTHETIC_CREDENTIAL);
  });
});

// Positive control: the classes that already worked must keep winning over
// the new fallback, with their remedies unchanged.
describe("already-classified statuses keep precedence over the fallback", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly status: number;
    readonly headers?: Record<string, string>;
    readonly expected: new (...args: never[]) => Error;
    readonly remedy: string;
  }> = [
    {
      name: "429 is still an Admin API rate limit",
      status: 429,
      expected: AdminRateLimitError,
      remedy: "This client exceeded the Admin API rate.",
    },
    {
      name: "503 with x-error (429) is still a content-source throttle",
      status: 503,
      headers: { "x-error": "failed (429)" },
      expected: ContentSourceThrottledError,
      remedy: "The CONTENT SOURCE behind this site is throttling",
    },
    { name: "502 is still a gateway failure", status: 502, expected: GatewayError, remedy: "The gateway in front of the Admin API failed." },
    { name: "504 is still a gateway failure", status: 504, expected: GatewayError, remedy: "The gateway in front of the Admin API failed." },
    {
      name: "503 without a throttle signature is still upstream-unavailable",
      status: 503,
      expected: UpstreamUnavailableError,
      remedy: "The Admin API returned an unavailable/error status unrelated to rate limiting.",
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const init: ResponseInit = testCase.headers === undefined ? { status: testCase.status } : { status: testCase.status, headers: testCase.headers };
      const client = makeClient((async () => new Response(null, init)) as typeof globalThis.fetch);

      const error = await rejection(client.send({ method: "GET", path: "/config/acme-demo-org.json" }));

      expect(error).toBeInstanceOf(testCase.expected);
      expect(error).not.toBeInstanceOf(AdminApiStatusError);
      expect(error).not.toBeInstanceOf(AdminApiAuthError);
      expect((error as EdsErrorLike).remedy).toContain(testCase.remedy);
    });
  }
});

interface EdsErrorLike {
  readonly remedy: string;
}
