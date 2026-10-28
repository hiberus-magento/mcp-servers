// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import { createAuthorDouble, SYNTHETIC_ROOT } from "../testing/author-double.js";
import { InvalidAemPathError } from "../guard/paths.js";
import { listTemplates, probeAuth, queryPages, queryPublishedPages, readPage, readPageTree, readSheet } from "./reads.js";

const PAGE = `${SYNTHETIC_ROOT}/en/outdoor-gear`;
const SHEET = `${SYNTHETIC_ROOT}/metadata`;

describe("queryPages", () => {
  it("builds bounded QueryBuilder predicates and projects hits", async () => {
    const { http, calls } = createAuthorDouble({
      [`GET /bin/querybuilder.json?path=%2Fcontent%2Facme-demo-site-eu&path.self=true&type=cq%3APage&orderby=path&p.limit=2&p.offset=0&p.guessTotal=false`]: {
        status: 200,
        body: {
          total: 3,
          more: true,
          hits: [
            { path: SYNTHETIC_ROOT, title: "EU", lastModified: "2026-10-01", excerpt: "x", acmeSecret: "s" },
            { path: `${SYNTHETIC_ROOT}/en`, name: "en" },
            { title: "no path" },
          ],
        },
      },
    });
    const result = await queryPages(http, { root: SYNTHETIC_ROOT, limit: 2 });
    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      root: SYNTHETIC_ROOT,
      total: 3,
      offset: 0,
      more: true,
      pages: [{ path: SYNTHETIC_ROOT, title: "EU", lastModified: "2026-10-01" }, { path: `${SYNTHETIC_ROOT}/en` }],
    });
    expect(JSON.stringify(result)).not.toContain("acmeSecret");
  });

  it("caps the limit at 200 and supports direct children only", async () => {
    const { http, calls } = createAuthorDouble({
      [`GET /bin/querybuilder.json?path=%2Fcontent%2Facme-demo-site-eu&type=cq%3APage&orderby=path&p.limit=200&p.offset=5&p.guessTotal=false&path.flat=true`]: {
        status: 200,
        body: { total: 0, hits: [] },
      },
    });
    await queryPages(http, { root: SYNTHETIC_ROOT, limit: 5000, offset: 5, childrenOnly: true });
    expect(calls).toHaveLength(1);
  });

  it("refuses a root that is not a page path", async () => {
    const { http } = createAuthorDouble({});
    await expect(queryPages(http, { root: "/content/x&path=/apps" })).rejects.toBeInstanceOf(InvalidAemPathError);
  });
});

describe("readPage", () => {
  it("projects allowlisted properties, replication state and declared extras only", async () => {
    const { http } = createAuthorDouble({
      [`GET ${PAGE}/jcr:content.json`]: {
        status: 200,
        body: {
          "jcr:primaryType": "cq:PageContent",
          "jcr:title": "Outdoor gear",
          "cq:robotsTags": ["noindex", "nofollow"],
          "cq:template": "/conf/acme/settings/wcm/templates/page",
          hideInNav: "true",
          acmeTeaser: "Hello",
          acmeInternalNote: "do not leak",
          "rep:policy": {},
          "cq:lastReplicationAction": "Activate",
          "cq:lastReplicated": "2026-10-01T10:00:00.000Z",
          "cq:lastReplicationAction_preview": "Deactivate",
        },
      },
    });
    const page = await readPage(http, PAGE, ["acmeTeaser"]);
    expect(page).toEqual({
      path: PAGE,
      properties: {
        "jcr:title": "Outdoor gear",
        "cq:template": "/conf/acme/settings/wcm/templates/page",
        acmeTeaser: "Hello",
        "cq:robotsTags": ["noindex", "nofollow"],
        hideInNav: true,
      },
      replication: { publish: { lastAction: "Activate", lastReplicated: "2026-10-01T10:00:00.000Z" }, preview: { lastAction: "Deactivate" } },
    });
    expect(JSON.stringify(page)).not.toContain("do not leak");
  });

  it("returns undefined for a missing page or a node that is not a page", async () => {
    const { http } = createAuthorDouble({
      [`GET ${PAGE}/jcr:content.json`]: { status: 404 },
      [`GET ${SYNTHETIC_ROOT}/x/jcr:content.json`]: { status: 200, body: { "jcr:primaryType": "nt:unstructured" } },
    });
    expect(await readPage(http, PAGE)).toBeUndefined();
    expect(await readPage(http, `${SYNTHETIC_ROOT}/x`)).toBeUndefined();
  });
});

describe("queryPublishedPages", () => {
  it("asks for pages activated on publish or preview under a root", async () => {
    const { http, calls } = createAuthorDouble({
      [`GET /bin/querybuilder.json?path=${encodeURIComponent(PAGE)}&path.self=true&type=cq%3APage&group.p.or=true&group.1_property=jcr%3Acontent%2Fcq%3AlastReplicationAction&group.1_property.value=Activate&group.2_property=jcr%3Acontent%2Fcq%3AlastReplicationAction_preview&group.2_property.value=Activate&p.limit=100`]:
        { status: 200, body: { hits: [{ path: `${PAGE}/tents` }] } },
    });
    expect(await queryPublishedPages(http, PAGE)).toEqual([`${PAGE}/tents`]);
    expect(calls).toHaveLength(1);
  });
});

describe("readSheet", () => {
  it("projects columns and, per row node, only declared columns", async () => {
    const { http } = createAuthorDouble({
      [`GET ${SHEET}/jcr:content.1.json`]: {
        status: 200,
        body: {
          "jcr:primaryType": "cq:PageContent",
          columns: ["URL", "Robots"],
          row: { "jcr:primaryType": "nt:unstructured", URL: "/**", Robots: "noindex, nofollow", hidden: "x" },
          row0: { "jcr:primaryType": "nt:unstructured", URL: "/en" },
          "rep:policy": { "jcr:primaryType": "rep:ACL" },
        },
      },
    });
    expect(await readSheet(http, SHEET)).toEqual({
      path: SHEET,
      columns: ["URL", "Robots"],
      rows: [
        { node: "row", values: { URL: "/**", Robots: "noindex, nofollow" } },
        { node: "row0", values: { URL: "/en" } },
      ],
    });
  });

  it("returns undefined when the sheet does not exist", async () => {
    const { http } = createAuthorDouble({ [`GET ${SHEET}/jcr:content.1.json`]: { status: 404 } });
    expect(await readSheet(http, SHEET)).toBeUndefined();
  });
});

describe("readPageTree", () => {
  it("bounds the depth to 1..4 and drops access control and bookkeeping", async () => {
    const { http, calls } = createAuthorDouble({
      [`GET ${PAGE}/jcr:content.4.json`]: {
        status: 200,
        body: {
          "jcr:primaryType": "cq:PageContent",
          "jcr:title": "T",
          "cq:lastModified": "x",
          "rep:policy": { "jcr:primaryType": "rep:ACL", allow: { principalName: "everyone" } },
          root: { "sling:resourceType": "core/franklin/components/root/v1/root", section: { text: "Hello", tags: ["a"], n: 1 } },
        },
      },
    });
    const tree = await readPageTree(http, PAGE, 9);
    expect(calls[0]?.url).toContain("jcr:content.4.json");
    expect(tree).toEqual({
      name: "jcr:content",
      properties: { "jcr:title": "T" },
      children: [
        {
          name: "root",
          resourceType: "core/franklin/components/root/v1/root",
          properties: {},
          children: [{ name: "section", properties: { text: "Hello", tags: ["a"], n: 1 }, children: [] }],
        },
      ],
    });
  });
});

describe("listTemplates and probeAuth", () => {
  it("lists templates under a /conf root only", async () => {
    const { http } = createAuthorDouble({
      "GET /bin/querybuilder.json?path=%2Fconf%2Facme&type=cq%3ATemplate&orderby=path&p.limit=200": {
        status: 200,
        body: { hits: [{ path: "/conf/acme/settings/wcm/templates/page", title: "Page" }] },
      },
    });
    expect(await listTemplates(http, "/conf/acme")).toEqual([{ path: "/conf/acme/settings/wcm/templates/page", title: "Page" }]);
    await expect(listTemplates(http, "/apps/acme")).rejects.toThrow(/not a \/conf path/);
  });

  it("probes QueryBuilder with p.limit=1", async () => {
    const { http, calls } = createAuthorDouble({
      "GET /bin/querybuilder.json?path=%2Fcontent%2Facme-demo-site-eu&type=cq%3APage&p.limit=1": { status: 200, body: { hits: [] } },
    });
    expect(await probeAuth(http, SYNTHETIC_ROOT)).toEqual({ status: 200 });
    expect(calls).toHaveLength(1);
  });
});
