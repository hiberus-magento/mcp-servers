// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first (tasks.md 4.13): a snapshot-creating POST must always carry an
// explicit, non-empty JSON body with a content-type header — an empty body
// is inferred only to mean "add everything" and is never relied upon
// (eds-client spec, "Explicit JSON Body on Snapshot Writes").
import { describe, expect, it } from "vitest";
import { createFetchDouble } from "../../testing/fetch-double.js";
import { createHttpClient } from "../http.js";
import { AdminApiEmptyBodyError, AdminApiMalformedBodyError } from "../errors.js";
import { addToSnapshot, deleteSnapshot, listSnapshots, showSnapshot } from "./snapshots.js";

function makeHttp(routes: Record<string, unknown>) {
  const { fetch, calls } = createFetchDouble(routes as never);
  const http = createHttpClient({
    fetch,
    now: () => Date.now(),
    sleep: async () => undefined,
    tokenProvider: {
      domain: "eds",
      getToken: async () => ({ kind: "static" as const, value: "k" }),
      invalidate: () => undefined,
      describeRemedy: () => ({ domain: "eds", cliCommand: "hiberus-eds auth token set", envVar: "EDS_TOKEN", configPath: "/dev/null", reason: "not found" }),
    },
    baseUrl: "https://admin.hlx.page",
    org: "acme-demo-org",
  });
  return { http, calls };
}

describe("addToSnapshot", () => {
  it("always sends a non-empty JSON body with a content-type header when paths are supplied", async () => {
    const path = "/snapshot/acme-demo-org/acme-demo-site-eu/main/launch-2026";
    const { http, calls } = makeHttp({ [`POST ${path}`]: { status: 200, body: { snapshot: { id: "launch-2026" } } } });

    await addToSnapshot(http, { org: "acme-demo-org", site: "acme-demo-site-eu", id: "launch-2026", paths: ["/index.html"] });

    expect(calls[0]?.body).toBeTruthy();
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ paths: ["/index.html"] });
    expect(calls[0]?.headers["content-type"]).toContain("application/json");
  });

  it("still sends an explicit, non-empty JSON body when the caller supplies no paths (never a bodyless POST)", async () => {
    const path = "/snapshot/acme-demo-org/acme-demo-site-eu/main/launch-2026";
    const { http, calls } = makeHttp({ [`POST ${path}`]: { status: 200, body: { snapshot: { id: "launch-2026" } } } });

    await addToSnapshot(http, { org: "acme-demo-org", site: "acme-demo-site-eu", id: "launch-2026" });

    expect(calls[0]?.body).toBeTruthy();
    expect(calls[0]?.body).not.toBe("");
    expect(calls[0]?.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ paths: [] });
  });
});

describe("listSnapshots", () => {
  it("lists snapshots pinned to main", async () => {
    const path = "/snapshot/acme-demo-org/acme-demo-site-eu/main";
    const { http } = makeHttp({ [`GET ${path}`]: { status: 200, body: [{ id: "launch-2026" }] } });

    const result = await listSnapshots(http, { org: "acme-demo-org", site: "acme-demo-site-eu" });

    expect(result).toEqual([{ id: "launch-2026" }]);
  });
});

// RED-first: the decisive input is a SUCCESSFUL response that carries no
// body at all. Observed live against the Admin API, the snapshot endpoints
// answer `DELETE` with `204 text/plain; charset=utf-8` and zero bytes,
// while `POST` and `GET` answer 200 with a JSON document. Every test above
// — and every test the previous status-handling fix added — handed the
// parser a body, so a deletion that had in fact succeeded reached the
// operator as `Unexpected end of JSON input`.
const SNAPSHOT_PATH = "/snapshot/acme-demo-org/acme-demo-site-eu/main/launch-2026";
const EMPTY_204 = { status: 204, headers: { "content-type": "text/plain; charset=utf-8" } };

type Settled = { readonly kind: "resolved"; readonly value: unknown } | { readonly kind: "rejected"; readonly error: unknown };

function settle(promise: Promise<unknown>): Promise<Settled> {
  return promise.then(
    (value): Settled => ({ kind: "resolved", value }),
    (error: unknown): Settled => ({ kind: "rejected", error }),
  );
}

function messageOf(settled: Settled): string {
  if (settled.kind === "resolved") {
    return "";
  }
  return settled.error instanceof Error ? settled.error.message : String(settled.error);
}

describe("deleteSnapshot", () => {
  it("resolves a 204 with a zero-length body as a successful deletion that returned nothing, never as a parse failure", async () => {
    const { http } = makeHttp({ [`DELETE ${SNAPSHOT_PATH}`]: EMPTY_204 });

    const settled = await settle(deleteSnapshot(http, { org: "acme-demo-org", site: "acme-demo-site-eu", id: "launch-2026" }));

    // The message is asserted, not just the outcome: the defect was that a
    // working destructive operation reported a JSON error to the operator.
    expect(messageOf(settled)).not.toContain("JSON input");
    expect(settled).toEqual({ kind: "resolved", value: { status: 204, hasContent: false } });
  });

  it("reports the body when the Admin API does answer the delete with one, so 'done' stays distinguishable from 'done, and here is what came back'", async () => {
    const { http } = makeHttp({ [`DELETE ${SNAPSHOT_PATH}`]: { status: 200, body: { deleted: "launch-2026" } } });

    const result = await deleteSnapshot(http, { org: "acme-demo-org", site: "acme-demo-site-eu", id: "launch-2026" });

    expect(result).toEqual({ status: 200, hasContent: true, content: { deleted: "launch-2026" } });
  });

  // Positive control: tolerating an ABSENT body must not become tolerating
  // an UNREADABLE one. Zero bytes is "the API said nothing"; a non-JSON
  // payload is the API saying something this client cannot read, and that
  // is still a failure.
  it("still fails loudly when a successful delete answers with a body that is not JSON", async () => {
    const { http } = makeHttp({
      [`DELETE ${SNAPSHOT_PATH}`]: { status: 200, headers: { "content-type": "text/html" }, body: "<html>gateway timeout</html>" },
    });

    const settled = await settle(deleteSnapshot(http, { org: "acme-demo-org", site: "acme-demo-site-eu", id: "launch-2026" }));

    expect(settled.kind).toBe("rejected");
    expect(settled.kind === "rejected" ? settled.error : undefined).toBeInstanceOf(AdminApiMalformedBodyError);
    expect(messageOf(settled)).toContain("DELETE");
    expect(messageOf(settled)).toContain(SNAPSHOT_PATH);
    expect(messageOf(settled)).not.toContain("JSON input");
  });
});

// Positive control: a read exists to return a document. An empty body
// there is a real failure and must never be swallowed into a success that
// an agent would read as "this snapshot returned nothing".
describe("showSnapshot", () => {
  it("fails loudly when a 200 carries no body, rather than reporting an absent document as a successful empty one", async () => {
    const { http } = makeHttp({ [`GET ${SNAPSHOT_PATH}`]: { status: 200 } });

    const settled = await settle(showSnapshot(http, { org: "acme-demo-org", site: "acme-demo-site-eu", id: "launch-2026" }));

    expect(settled.kind).toBe("rejected");
    expect(settled.kind === "rejected" ? settled.error : undefined).toBeInstanceOf(AdminApiEmptyBodyError);
    expect(messageOf(settled)).toContain("GET");
    expect(messageOf(settled)).toContain(SNAPSHOT_PATH);
    expect(messageOf(settled)).not.toContain("JSON input");
  });
});
