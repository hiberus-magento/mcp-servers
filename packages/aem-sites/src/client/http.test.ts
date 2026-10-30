// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { createAuthorDouble, CSRF_ROUTE, SYNTHETIC_AEM_AUTHOR, SYNTHETIC_TOKEN, tokenProvider } from "../testing/author-double.js";
import { createFetchDouble } from "../testing/fetch-double.js";
import { AemAuthError, AemMalformedBodyError, AemStatusError, InvalidAuthorOriginError } from "./errors.js";
import { assertAuthorOrigin, createAuthorHttp } from "./http.js";

describe("author origin pinning", () => {
  it("accepts an AEM as a Cloud Service author origin", () => {
    expect(assertAuthorOrigin(SYNTHETIC_AEM_AUTHOR)).toBe(SYNTHETIC_AEM_AUTHOR);
  });

  for (const origin of [
    "https://example-domain.invalid",
    "http://author-p00000-e00001.adobeaemcloud.com",
    "https://publish-p00000-e00001.adobeaemcloud.com",
    `${SYNTHETIC_AEM_AUTHOR}/`,
    `${SYNTHETIC_AEM_AUTHOR}.example-domain.invalid`,
    `${SYNTHETIC_AEM_AUTHOR}:8443`,
  ]) {
    it(`refuses ${origin}`, () => {
      expect(() => assertAuthorOrigin(origin)).toThrow(InvalidAuthorOriginError);
      expect(() =>
        createAuthorHttp({ fetch: globalThis.fetch, now: () => 0, sleep: async () => undefined, tokenProvider: tokenProvider(), origin }),
      ).toThrow(InvalidAuthorOriginError);
    });
  }
});

describe("GET", () => {
  it("sends the bearer to the pinned origin and never follows redirects", async () => {
    const { http, calls } = createAuthorDouble({ "GET /content/x.json": { status: 200, body: { a: 1 } } });
    const result = await http.readJson({ method: "GET", path: "/content/x.json" });
    expect(result.body).toEqual({ a: 1 });
    expect(calls[0]?.url).toBe(`${SYNTHETIC_AEM_AUTHOR}/content/x.json`);
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${SYNTHETIC_TOKEN}`);
  });

  it("passes redirect: manual to fetch", async () => {
    let seen: RequestInit | undefined;
    const http = createAuthorHttp({
      fetch: (async (_url: URL, init: RequestInit) => {
        seen = init;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof globalThis.fetch,
      now: () => 0,
      sleep: async () => undefined,
      tokenProvider: tokenProvider(),
      origin: SYNTHETIC_AEM_AUTHOR,
    });
    await http.send({ method: "GET", path: "/x.json" });
    expect(seen?.redirect).toBe("manual");
  });

  it("turns a redirect into AemAuthError without requesting the target", async () => {
    const { http, calls } = createAuthorDouble({ "GET /x.json": { status: 302, headers: { location: "https://login.example-domain.invalid/" } } });
    const error = await http.send({ method: "GET", path: "/x.json" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AemAuthError);
    expect((error as AemAuthError).reason).toBe("redirected-to-login");
    expect(calls).toHaveLength(1);
  });

  it("turns 401 into AemAuthError naming the renew command, never the token", async () => {
    const { http } = createAuthorDouble({ "GET /x.json": { status: 401 } });
    const error = (await http.send({ method: "GET", path: "/x.json" }).catch((e: unknown) => e)) as AemAuthError;
    expect(error.reason).toBe("token-expired-or-invalid");
    expect(error.message).toContain("hiberus-aem-sites auth token set --env stage");
    expect(error.message).not.toContain(SYNTHETIC_TOKEN);
  });

  it("turns an HTML 200 (login page) into AemAuthError when JSON is expected", async () => {
    const { http } = createAuthorDouble({ "GET /x.json": { status: 200, body: "<!DOCTYPE html><html>login</html>" } });
    const error = (await http.readJson({ method: "GET", path: "/x.json" }).catch((e: unknown) => e)) as AemAuthError;
    expect(error).toBeInstanceOf(AemAuthError);
    expect(error.reason).toBe("redirected-to-login");
  });

  it("names a malformed JSON body", async () => {
    const { http } = createAuthorDouble({ "GET /x.json": { status: 200, body: "{not json" } });
    await expect(http.readJson({ method: "GET", path: "/x.json" })).rejects.toBeInstanceOf(AemMalformedBodyError);
  });

  it("hands back an expected status instead of throwing", async () => {
    const { http } = createAuthorDouble({ "GET /x.json": { status: 404 } });
    const result = await http.readJson({ method: "GET", path: "/x.json", expectedStatuses: [404] });
    expect(result).toEqual({ status: 404, body: undefined });
  });

  it("does not retry 401", async () => {
    const { http, calls } = createAuthorDouble({ "GET /x.json": { status: 401 } });
    await expect(http.send({ method: "GET", path: "/x.json" })).rejects.toBeInstanceOf(AemAuthError);
    expect(calls).toHaveLength(1);
  });

  it("backs off on 429/5xx up to three times, honouring Retry-After", async () => {
    const { http, calls, sleeps } = createAuthorDouble({
      "GET /x.json": [{ status: 429, headers: { "retry-after": "2" } }, { status: 503 }, { status: 200, body: {} }],
    });
    await http.send({ method: "GET", path: "/x.json" });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it("gives up after three throttle retries with a named status error", async () => {
    const { http, calls } = createAuthorDouble({ "GET /x.json": { status: 503 } });
    await expect(http.send({ method: "GET", path: "/x.json" })).rejects.toBeInstanceOf(AemStatusError);
    expect(calls).toHaveLength(4);
  });
});

describe("POST", () => {
  const form = [
    ["jcr:title", "Outdoor gear"],
    ["_charset_", "utf-8"],
  ] as const;

  it("fetches a CSRF token first and sends it with form-encoded bytes", async () => {
    const { http, calls } = createAuthorDouble({ "POST /content/x/jcr:content": { status: 200, body: {} } });
    await http.send({ method: "POST", path: "/content/x/jcr:content", form });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["GET /libs/granite/csrf/token.json", "POST /content/x/jcr:content"]);
    expect(calls[1]?.headers["csrf-token"]).toBe("csrf-demo");
    expect(calls[1]?.headers.authorization).toBe(`Bearer ${SYNTHETIC_TOKEN}`);
    expect(calls[1]?.body).toBe("jcr%3Atitle=Outdoor+gear&_charset_=utf-8");
  });

  it("caches the CSRF token for 60 s", async () => {
    let now = 0;
    const { http, calls } = createAuthorDouble({ "POST /a": { status: 200 } }, { now: () => now });
    await http.send({ method: "POST", path: "/a", form });
    now = 59_000;
    await http.send({ method: "POST", path: "/a", form });
    now = 61_000;
    await http.send({ method: "POST", path: "/a", form });
    expect(calls.filter((c) => c.url.endsWith("/libs/granite/csrf/token.json"))).toHaveLength(2);
  });

  it("refreshes the CSRF token once on 403 and resends identical bytes", async () => {
    const { http, calls } = createAuthorDouble({
      [CSRF_ROUTE]: [
        { status: 200, body: { token: "stale" } },
        { status: 200, body: { token: "fresh" } },
      ],
      "POST /a": [{ status: 403 }, { status: 200 }],
    });
    await http.send({ method: "POST", path: "/a", form });
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => c.headers["csrf-token"])).toEqual(["stale", "fresh"]);
    expect(posts[0]?.body).toBe(posts[1]?.body);
  });

  it("retries 409 after 1 s, 2 s and 4 s (sheet just created)", async () => {
    const { http, sleeps, calls } = createAuthorDouble({ "POST /a": [{ status: 409 }, { status: 409 }, { status: 200 }] });
    await http.send({ method: "POST", path: "/a", form });
    expect(sleeps).toEqual([1000, 2000]);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(3);
  });

  it("gives up on 409 after the third retry", async () => {
    const { http, sleeps } = createAuthorDouble({ "POST /a": { status: 409 } });
    await expect(http.send({ method: "POST", path: "/a", form })).rejects.toBeInstanceOf(AemStatusError);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("retries a replicate 400 exactly once after 3 s", async () => {
    const path = "/bin/replicate?cmd=Activate&path=%2Fcontent%2Fx";
    const { http, sleeps } = createAuthorDouble({ [`POST ${path}`]: [{ status: 400 }, { status: 200 }] });
    await http.send({ method: "POST", path, form: [] });
    expect(sleeps).toEqual([3000]);
  });

  it("does not retry 400 on anything but replicate", async () => {
    const { http, sleeps } = createAuthorDouble({ "POST /a": { status: 400, body: "bad" } });
    await expect(http.send({ method: "POST", path: "/a", form })).rejects.toThrow(/HTTP 400: bad/);
    expect(sleeps).toEqual([]);
  });

  it("a CSRF endpoint answering the login page is an auth error", async () => {
    const double = createFetchDouble({ [CSRF_ROUTE]: { status: 200, body: "<html>login</html>" } });
    const http = createAuthorHttp({ fetch: double.fetch, now: () => 0, sleep: async () => undefined, tokenProvider: tokenProvider(), origin: SYNTHETIC_AEM_AUTHOR });
    await expect(http.send({ method: "POST", path: "/a", form })).rejects.toBeInstanceOf(AemAuthError);
  });
});
