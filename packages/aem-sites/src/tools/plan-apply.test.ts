// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// aem-sites-mcp spec: "Every Write Goes Through aem_plan and aem_apply",
// "Plan Result Is Self-Describing", "Write Roots", "Property Allowlist and
// Operator Ban", "Protected Environments and Paths", "Delete Refuses
// Published Content". The token matrix runs for EVERY operation kind.
import { describe, expect, it } from "vitest";
import { parseConfig, type AemConfig } from "../config.js";
import { createPlanStore, type PlanStore } from "../confirm/plan-store.js";
import { SYNTHETIC_AEM_AUTHOR, SYNTHETIC_ROOT } from "../testing/author-double.js";
import { createFakeAuthor, type FakeAuthor } from "../testing/fake-author.js";
import { applyPlan, ROLLOUT_POLL_MS, ROLLOUT_TIMEOUT_MS, type ApplyResult } from "./apply.js";
import { AGENT_PAUSE_MS, BATCH_READ_RETRIES, BATCH_READ_RETRY_MS, BATCH_TTL_MS, COMPONENT_INHERITANCE_WARNING, EDS_LIVE_WARNING, planOperation, PUSH_ON_MODIFY_WARNING, ROLLOUT_WARNING, type PlanResult, type StoredPlan } from "./plan-builder.js";
import { OPERATION_KINDS, type AemApplyInput, type OperationKind, type PlanOperation, type SinglePlanOperation } from "./plan-schema.js";

const EN = `${SYNTHETIC_ROOT}/en`;
const FR = `${SYNTHETIC_ROOT}/fr`;
const PAGE = `${EN}/outdoor-gear`;
const OLD = `${EN}/old`;
const LOCKED = `${EN}/locked`;
const BLOCK = `${PAGE}/jcr:content/root/section/block`;
const SHEET = `${SYNTHETIC_ROOT}/metadata`;
const FR_SHEET = `${FR}/metadata`;
const TTL = 1_000;
const DEFAULT_CONFIG = "/libs/msm/wcm/rolloutconfigs/default";
const PUSH_ON_MODIFY = "/libs/msm/wcm/rolloutconfigs/pushonmodify";
const LIVE_COPY = `${FR}/gear-live`;

function seed(author: FakeAuthor): void {
  author.pages.set(EN, { "jcr:title": "EN" });
  author.pages.set(FR, { "jcr:title": "FR" });
  author.pages.set(PAGE, { "jcr:title": "Outdoor gear", "cq:lastReplicationAction": "Activate", "cq:lastModified": "1" });
  author.pages.set(OLD, { "jcr:title": "Old" });
  author.pages.set(`${FR}/gear-live`, {
    "jcr:title": "Outdoor gear (FR)",
    "cq:LiveSyncConfig": { "cq:master": PAGE, "cq:rolloutConfigs": [DEFAULT_CONFIG], "cq:isDeep": true },
  });
  author.pages.set(LOCKED, { "jcr:title": "Locked", "jcr:lockOwner": author.currentUser.id });
  author.components.set(BLOCK, {
    "jcr:primaryType": "nt:unstructured",
    "sling:resourceType": "core/franklin/components/block/v1/block",
    name: "commerce-cart",
    model: "commerce-cart",
    "checkout-url": `${EN}/checkout`,
    "start-shopping-url": EN,
  });
  author.sheets.set(FR_SHEET, {
    "jcr:primaryType": "cq:PageContent",
    columns: ["url", "Robots"],
    row: { "jcr:primaryType": "nt:unstructured", url: "/**", Robots: "noindex, nofollow" },
  });
}

interface Harness {
  readonly author: FakeAuthor;
  readonly config: AemConfig;
  readonly store: PlanStore<StoredPlan>;
  plan(operation: PlanOperation, env?: string): Promise<PlanResult>;
  apply(input: AemApplyInput): Promise<ApplyResult>;
  advance(ms: number): void;
}

function harness(variables: Record<string, string> = {}): Harness {
  const author = createFakeAuthor();
  seed(author);
  let now = 0;
  const config = parseConfig({
    AEM_AUTHORS: `stage=${SYNTHETIC_AEM_AUTHOR},prod=https://author-p00000-e00002.adobeaemcloud.com`,
    AEM_WRITE_ROOTS: SYNTHETIC_ROOT,
    ...variables,
  });
  const store = createPlanStore<StoredPlan>({ now: () => now, ttlMs: TTL });
  const deps = { config, clientFor: () => author.client, store, now: () => now };
  return {
    author,
    config,
    store,
    plan: (operation, env = "stage") => planOperation(deps, { env, operation }),
    apply: (input) => applyPlan({ ...deps, sleep: async (ms) => void author.sleeps.push(ms) }, input),
    advance: (ms) => {
      now += ms;
    },
  };
}

function planned(result: PlanResult): Extract<PlanResult, { status: "planned" }> {
  if (result.status !== "planned") {
    throw new Error(`expected a plan, got ${JSON.stringify(result)}`);
  }
  return result;
}

/** One valid operation per kind, plus a mutation that makes its plan stale. */
type SingleKind = Exclude<OperationKind, "batch">;
const SINGLE_KINDS = OPERATION_KINDS.filter((kind): kind is SingleKind => kind !== "batch");

const CASES: Record<SingleKind, { readonly operation: PlanOperation; readonly stale: (author: FakeAuthor) => void }> = {
  "page.set-properties": {
    operation: { kind: "page.set-properties", path: PAGE, set: { "jcr:title": "Gear" } },
    stale: (a) => a.pages.set(PAGE, { ...a.pages.get(PAGE), "jcr:title": "Edited meanwhile" }),
  },
  "component.set-properties": {
    operation: { kind: "component.set-properties", path: BLOCK, set: { "checkout-url": "/checkout" } },
    stale: (a) => a.components.set(BLOCK, { ...a.components.get(BLOCK), "checkout-url": "/edited-in-the-editor" }),
  },
  "page.set-robots": {
    operation: { kind: "page.set-robots", paths: [PAGE], robots: ["noindex", "nofollow"] },
    stale: (a) => a.pages.set(PAGE, { ...a.pages.get(PAGE), "cq:lastModified": "2" }),
  },
  "sheet.upsert-row": {
    operation: { kind: "sheet.upsert-row", sheetPath: SHEET, match: { column: "URL", value: "/**" }, values: { Robots: "noindex, nofollow" } },
    stale: (a) => a.sheets.set(SHEET, { "jcr:primaryType": "cq:PageContent", columns: ["url"] }),
  },
  "sheet.delete-row": {
    operation: { kind: "sheet.delete-row", sheetPath: FR_SHEET, match: { column: "URL", value: "/**" } },
    stale: (a) => a.sheets.delete(FR_SHEET),
  },
  "page.publish": {
    operation: { kind: "page.publish", paths: [PAGE], target: "both" },
    stale: (a) => a.pages.set(PAGE, { ...a.pages.get(PAGE), "cq:lastModified": "2" }),
  },
  "page.publish-tree": {
    operation: { kind: "page.publish-tree", root: EN, target: "preview" },
    stale: (a) => a.pages.set(OLD, { ...a.pages.get(OLD), "cq:lastModified": "2" }),
  },
  "page.unpublish": {
    operation: { kind: "page.unpublish", paths: [PAGE], target: "publish" },
    stale: (a) => a.pages.set(PAGE, { ...a.pages.get(PAGE), "cq:lastReplicationAction": "Deactivate" }),
  },
  "page.create": {
    operation: { kind: "page.create", parentPath: EN, name: "tents", title: "Tents", template: "/conf/acme/settings/wcm/templates/page" },
    stale: (a) => a.pages.set(`${EN}/tents`, { "jcr:title": "Someone else's" }),
  },
  "page.copy": {
    operation: { kind: "page.copy", srcPath: PAGE, destParentPath: FR },
    stale: (a) => a.pages.set(`${FR}/outdoor-gear`, {}),
  },
  "page.move": {
    operation: { kind: "page.move", srcPath: OLD, destParentPath: FR },
    stale: (a) => a.pages.delete(FR),
  },
  "page.delete": {
    operation: { kind: "page.delete", path: OLD },
    stale: (a) => a.pages.set(OLD, { "jcr:title": "Old, edited" }),
  },
  "livecopy.create": {
    operation: { kind: "livecopy.create", srcPath: PAGE, destParentPath: FR, name: "gear-lc", title: "Gear LC" },
    stale: (a) => a.pages.set(`${FR}/gear-lc`, {}),
  },
  "livecopy.rollout": {
    operation: { kind: "livecopy.rollout", path: PAGE, targets: [`${FR}/gear-live`] },
    stale: (a) => a.pages.delete(`${FR}/gear-live`),
  },
  "livecopy.set-rollout-configs": {
    operation: { kind: "livecopy.set-rollout-configs", path: LIVE_COPY, rolloutConfigs: [DEFAULT_CONFIG, PUSH_ON_MODIFY] },
    stale: (a) => a.pages.set(LIVE_COPY, { ...a.pages.get(LIVE_COPY), "cq:LiveSyncConfig": { "cq:master": PAGE, "cq:rolloutConfigs": ["/libs/msm/wcm/rolloutconfigs/activate"] } }),
  },
  "page.lock": {
    operation: { kind: "page.lock", path: OLD },
    stale: (a) => a.pages.set(OLD, { "jcr:title": "Old", "jcr:lockOwner": "someone-else" }),
  },
  "page.unlock": {
    operation: { kind: "page.unlock", path: LOCKED },
    stale: (a) => a.pages.set(LOCKED, { ...a.pages.get(LOCKED), "cq:lastModified": "2" }),
  },
};

describe("every operation kind", () => {
  it("has a case here, so the matrix below is exhaustive", () => {
    expect(Object.keys(CASES).sort()).toEqual([...SINGLE_KINDS].sort());
  });

  for (const kind of SINGLE_KINDS) {
    const { operation, stale } = CASES[kind];

    describe(kind, () => {
      it("plans without writing, then applies exactly the planned requests", async () => {
        const h = harness();
        const plan = planned(await h.plan(operation));
        expect(h.author.posts()).toEqual([]);
        expect(plan.instruction).toContain("aem_apply");
        expect(plan.confirmationMessage).toContain(plan.summary);
        const result = await h.apply({ token: plan.token, env: "stage", kind });
        expect(result.status).toBe("applied");
        expect(h.author.posts().map((r) => r.path)).toEqual(plan.requests.map((r) => r.path));
      });

      it("writes nothing for a forged token", async () => {
        const h = harness();
        await h.plan(operation);
        expect(await h.apply({ token: "forged", env: "stage", kind })).toMatchObject({ status: "rejected", reason: "unknown-token" });
        expect(h.author.posts()).toEqual([]);
      });

      it("writes nothing for an expired token", async () => {
        const h = harness();
        const plan = planned(await h.plan(operation));
        h.advance(TTL);
        expect(await h.apply({ token: plan.token, env: "stage", kind })).toMatchObject({ status: "rejected", reason: "expired" });
        expect(h.author.posts()).toEqual([]);
      });

      it("writes nothing the second time a token is used", async () => {
        const h = harness();
        const plan = planned(await h.plan(operation));
        await h.apply({ token: plan.token, env: "stage", kind });
        const writes = h.author.posts().length;
        expect(await h.apply({ token: plan.token, env: "stage", kind })).toMatchObject({ status: "rejected", reason: "already-applied" });
        expect(h.author.posts()).toHaveLength(writes);
      });

      it("writes nothing when the reviewed state changed (stale plan)", async () => {
        const h = harness();
        const plan = planned(await h.plan(operation));
        stale(h.author);
        expect(await h.apply({ token: plan.token, env: "stage", kind })).toMatchObject({ status: "rejected", reason: "stale-plan" });
        expect(h.author.posts()).toEqual([]);
      });

      it("writes nothing on a mismatched echo, and keeps the token valid", async () => {
        const h = harness();
        const plan = planned(await h.plan(operation));
        const otherKind = OPERATION_KINDS.find((k) => k !== kind) as OperationKind;
        expect(await h.apply({ token: plan.token, env: "prod", kind })).toMatchObject({ status: "rejected", reason: "env-mismatch" });
        expect(await h.apply({ token: plan.token, env: "stage", kind: otherKind })).toMatchObject({ status: "rejected", reason: "kind-mismatch" });
        expect(h.author.posts()).toEqual([]);
        expect((await h.apply({ token: plan.token, env: "stage", kind })).status).toBe("applied");
      });
    });
  }
});

describe("plan contents", () => {
  it("page.set-properties returns before/after and sends only changed properties", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "page.set-properties", path: PAGE, set: { "jcr:title": "Gear", "jcr:description": "New" } }));
    expect(plan.changes).toEqual([
      { path: PAGE, what: "jcr:title", before: "Outdoor gear", after: "Gear" },
      { path: PAGE, what: "jcr:description", before: undefined, after: "New" },
    ]);
    await h.apply({ token: plan.token, env: "stage", kind: "page.set-properties" });
    expect(h.author.posts()[0]?.body).toBe("jcr%3Atitle=Gear&jcr%3Adescription=New&_charset_=utf-8");
  });

  it("a no-op returns no-changes and no token", async () => {
    const h = harness();
    expect(await h.plan({ kind: "page.set-properties", path: PAGE, set: { "jcr:title": "Outdoor gear" } })).toEqual({
      status: "no-changes",
      env: "stage",
      kind: "page.set-properties",
      summary: `${PAGE} already has these properties.`,
    });
    h.author.pages.set(PAGE, { ...h.author.pages.get(PAGE), robots: "nofollow, NoIndex" });
    expect((await h.plan({ kind: "page.set-robots", paths: [PAGE], robots: ["noindex", "nofollow"] })).status).toBe("no-changes");
  });

  it("page.set-properties sets cq:conf to an existing configuration and says what it decides", async () => {
    const h = harness();
    h.author.confs.add("/conf/acme-demo-site/us");
    const plan = planned(await h.plan({ kind: "page.set-properties", path: OLD, set: { "cq:conf": "/conf/acme-demo-site/us" } }));
    expect(plan.changes).toEqual([{ path: OLD, what: "cq:conf", before: undefined, after: "/conf/acme-demo-site/us" }]);
    expect(plan.warnings.join(" ")).toContain("Edge Delivery Services site");
    await h.apply({ token: plan.token, env: "stage", kind: "page.set-properties" });
    expect(h.author.posts()[0]?.body).toContain(`cq%3Aconf=${encodeURIComponent("/conf/acme-demo-site/us")}`);
  });

  it("page.set-properties refuses a cq:conf that does not exist", async () => {
    const h = harness();
    expect(await h.plan({ kind: "page.set-properties", path: OLD, set: { "cq:conf": "/conf/acme-demo-site/missing" } })).toMatchObject({ status: "rejected", reason: "not-found" });
    expect(h.author.posts()).toEqual([]);
  });

  it("component.set-properties sends only the changed fields to the node and warns about rollouts", async () => {
    const h = harness();
    const plan = planned(
      await h.plan({ kind: "component.set-properties", path: BLOCK, set: { "checkout-url": "/checkout", "start-shopping-url": EN }, remove: ["max-items"] }),
    );
    expect(plan.changes).toEqual([{ path: BLOCK, what: "checkout-url", before: `${EN}/checkout`, after: "/checkout" }]);
    expect(plan.warnings).toContain(COMPONENT_INHERITANCE_WARNING);
    expect(plan.requests).toEqual([{ method: "POST", path: BLOCK, label: `component ${BLOCK}` }]);
    await h.apply({ token: plan.token, env: "stage", kind: "component.set-properties" });
    expect(h.author.posts()[0]).toMatchObject({ path: BLOCK, body: "checkout-url=%2Fcheckout&_charset_=utf-8" });
  });

  it("component.set-properties: a no-op, a missing node, a binding field and a page path", async () => {
    const h = harness();
    expect(await h.plan({ kind: "component.set-properties", path: BLOCK, set: { "start-shopping-url": EN } })).toEqual({
      status: "no-changes",
      env: "stage",
      kind: "component.set-properties",
      summary: `${BLOCK} already has these fields.`,
    });
    expect(await h.plan({ kind: "component.set-properties", path: `${PAGE}/jcr:content/root/section/missing`, set: { title: "x" } })).toMatchObject({
      status: "rejected",
      reason: "not-found",
    });
    expect(await h.plan({ kind: "component.set-properties", path: BLOCK, set: { model: "other" } })).toMatchObject({
      status: "rejected",
      reason: "forbidden-property-name",
    });
    expect(await h.plan({ kind: "component.set-properties", path: `${PAGE}/jcr:content`, set: { title: "x" } })).toMatchObject({
      status: "rejected",
      reason: "invalid-path",
    });
    expect(h.author.posts()).toEqual([]);
  });

  it("sheet.upsert-row creates the metadata sheet, its columns and the /** row (field-proven order)", async () => {
    const h = harness();
    const plan = planned(await h.plan(CASES["sheet.upsert-row"].operation));
    expect(plan.requests.map((r) => r.label)).toEqual([`create the sheet ${SHEET}`, `columns of ${SHEET}`, `add row row of ${SHEET}`]);
    expect(plan.warnings.join(" ")).toContain("/metadata.json");
  });

  it("sheet.upsert-row reuses the existing column casing and only updates changed cells", async () => {
    const h = harness();
    expect((await h.plan({ kind: "sheet.upsert-row", sheetPath: FR_SHEET, match: { column: "URL", value: "/**" }, values: { robots: "noindex, nofollow" } })).status).toBe(
      "no-changes",
    );
    const plan = planned(await h.plan({ kind: "sheet.upsert-row", sheetPath: FR_SHEET, match: { column: "URL", value: "/**" }, values: { robots: "" } }));
    await h.apply({ token: plan.token, env: "stage", kind: "sheet.upsert-row" });
    expect(h.author.posts()[0]).toMatchObject({ path: `${FR_SHEET}/jcr:content/row`, body: "Robots%40Delete=&_charset_=utf-8" });
  });

  it("page.publish to both pauses between agents and warns about EDS live", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "page.publish", paths: [PAGE, OLD], target: "both" }));
    expect(plan.warnings).toContain(EDS_LIVE_WARNING);
    await h.apply({ token: plan.token, env: "stage", kind: "page.publish" });
    expect(h.author.sleeps).toEqual([AGENT_PAUSE_MS]);
    expect(h.author.posts().map((r) => new URL(r.path, SYNTHETIC_AEM_AUTHOR).searchParams.get("type"))).toEqual(["preview", "preview", null, null]);
  });

  it("page.unpublish skips pages not activated on publish, but always unpublishes from preview (state unknown)", async () => {
    const h = harness();
    expect((await h.plan({ kind: "page.unpublish", paths: [OLD], target: "publish" })).status).toBe("no-changes");
    const plan = planned(await h.plan({ kind: "page.unpublish", paths: [OLD], target: "both" }));
    expect(plan.requests.map((r) => r.label)).toEqual([`unpublish ${OLD} (preview)`]);
    expect(plan.changes[0]?.before).toContain("unknown");
  });

  it("reports a failure mid-apply with what was and was not sent", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "page.publish", paths: [PAGE, OLD], target: "preview" }));
    h.author.postStatus.set(`/bin/replicate?cmd=Activate&path=${encodeURIComponent(OLD)}`, 500);
    const result = await h.apply({ token: plan.token, env: "stage", kind: "page.publish" });
    expect(result).toMatchObject({ status: "failed", completed: [{ label: `publish ${PAGE} (preview)`, status: 200 }], notSent: 0 });
  });
});

describe("rejections happen before any read or write", () => {
  const cases: [string, PlanOperation, string][] = [
    ["traversal", { kind: "page.set-properties", path: `${SYNTHETIC_ROOT}/../acme-demo-site-us/en`, set: { "jcr:title": "x" } }, "invalid-path"],
    ["outside the roots", { kind: "page.publish", paths: ["/content/acme-demo-site-us/en"], target: "publish" }, "path-outside-write-roots"],
    ["a smuggled Sling operator", { kind: "page.set-properties", path: PAGE, set: { "jcr:title@MoveFrom": "/content/x" } }, "forbidden-property-name"],
    ["a structural property", { kind: "page.set-properties", path: PAGE, set: { "sling:resourceType": "x" } }, "forbidden-property-name"],
    ["an operator as a sheet column", { kind: "sheet.upsert-row", sheetPath: SHEET, match: { column: ":operation", value: "delete" }, values: {} }, "forbidden-property-name"],
    ["a selector on the path", { kind: "page.delete", path: `${PAGE}.infinity.json` }, "invalid-path"],
  ];
  for (const [name, operation, reason] of cases) {
    it(name, async () => {
      const h = harness();
      expect(await h.plan(operation)).toMatchObject({ status: "rejected", reason });
      expect(h.author.requests).toEqual([]);
    });
  }

  it("no write roots configured", async () => {
    const h = harness({ AEM_WRITE_ROOTS: "" });
    expect(await h.plan(CASES["page.publish"].operation)).toMatchObject({ status: "rejected", reason: "path-outside-write-roots", message: expect.stringContaining("AEM_WRITE_ROOTS") });
  });

  it("an unknown environment", async () => {
    const h = harness();
    expect(await h.plan(CASES["page.publish"].operation, "qa")).toMatchObject({ status: "rejected", reason: "unknown-env" });
  });

  it("a missing page is named", async () => {
    const h = harness();
    expect(await h.plan({ kind: "page.publish", paths: [`${EN}/missing`], target: "publish" })).toMatchObject({ status: "rejected", reason: "not-found" });
  });
});

describe("protected environments and paths", () => {
  it("a protected env requires the user to type the env name", async () => {
    const h = harness({ AEM_PROTECTED_ENVS: "stage" });
    const plan = planned(await h.plan(CASES["page.set-properties"].operation));
    expect(plan.requiresConfirmTarget).toBe(true);
    expect(plan.confirmationMessage).toContain("type: stage");
    expect(await h.apply({ token: plan.token, env: "stage", kind: "page.set-properties" })).toMatchObject({ reason: "confirm-target-required" });
    expect(await h.apply({ token: plan.token, env: "stage", kind: "page.set-properties", confirmTarget: "prod" })).toMatchObject({ reason: "confirm-target-mismatch" });
    expect(h.author.posts()).toEqual([]);
    expect((await h.apply({ token: plan.token, env: "stage", kind: "page.set-properties", confirmTarget: "stage" })).status).toBe("applied");
  });

  it("publishing a protected path is blocked outright", async () => {
    const h = harness({ AEM_PROTECTED_PATHS: "/content/*/en" });
    expect(await h.plan(CASES["page.publish"].operation)).toMatchObject({ status: "rejected", reason: "protected-path-publish" });
    expect(h.author.requests).toEqual([]);
  });

  it("AEM_ALLOW_PROTECTED_PUBLISH=1 allows it, behind the typed pattern", async () => {
    const h = harness({ AEM_PROTECTED_PATHS: "/content/*/en", AEM_ALLOW_PROTECTED_PUBLISH: "1" });
    const plan = planned(await h.plan(CASES["page.publish"].operation));
    expect(plan.requiresConfirmTarget).toBe(true);
    expect(await h.apply({ token: plan.token, env: "stage", kind: "page.publish", confirmTarget: "/content/*/en" })).toMatchObject({ status: "applied" });
  });

  it("unpublishing a protected path is allowed, behind the typed pattern", async () => {
    const h = harness({ AEM_PROTECTED_PATHS: "/content/*/en" });
    const plan = planned(await h.plan(CASES["page.unpublish"].operation));
    expect(plan.requiresConfirmTarget).toBe(true);
  });
});

describe("page.delete", () => {
  it("refuses a published page or one with a published descendant, naming them", async () => {
    const h = harness();
    expect(await h.plan({ kind: "page.delete", path: EN })).toMatchObject({ status: "rejected", reason: "page-is-published", message: expect.stringContaining(PAGE) });
    expect(h.author.posts()).toEqual([]);
  });

  it("a forced delete says so, warns about broken links and sends force=true", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "page.delete", path: OLD, force: true }));
    expect(plan.summary).toContain("force");
    expect(plan.warnings.join(" ")).toContain("references");
    expect(plan.confirmationMessage).toContain("force");
    await h.apply({ token: plan.token, env: "stage", kind: "page.delete" });
    expect(h.author.posts()[0]?.body).toContain("force=true");
  });

  it("force never deletes published content", async () => {
    const h = harness();
    expect(await h.plan({ kind: "page.delete", path: EN, force: true })).toMatchObject({ status: "rejected", reason: "page-is-published" });
  });

  it("allowPublished deletes pages the author still marks as published, listing them in a warning", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "page.delete", path: EN, allowPublished: true, force: true }));
    expect(plan.summary).toContain("published");
    expect(plan.warnings.join(" ")).toContain(PAGE);
    expect(plan.warnings.join(" ")).toContain("orphan");
    await h.apply({ token: plan.token, env: "stage", kind: "page.delete" });
    expect(h.author.posts()[0]?.body).toContain(`path=${encodeURIComponent(EN)}`);
  });

  it("allowPublished on a page with nothing published adds no warning", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "page.delete", path: OLD, allowPublished: true }));
    expect(plan.warnings.join(" ")).not.toContain("orphan");
  });

  it("the published rejection names allowPublished only as the way out when the unpublish is refused", async () => {
    const h = harness();
    expect(await h.plan({ kind: "page.delete", path: EN })).toMatchObject({ message: expect.stringContaining("allowPublished: true") });
  });

  it("an unforced delete refused with 412 names the references and the way out", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "page.delete", path: OLD }));
    h.author.postStatus.set("/bin/wcmcommand", 412);
    const result = await h.apply({ token: plan.token, env: "stage", kind: "page.delete" });
    expect(result).toMatchObject({ status: "failed", failed: { message: expect.stringContaining("force: true") } });
  });

  it("a forced delete refused with 412 gets no hint to force again", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "page.delete", path: OLD, force: true }));
    h.author.postStatus.set("/bin/wcmcommand", 412);
    const result = await h.apply({ token: plan.token, env: "stage", kind: "page.delete" });
    expect(result).toMatchObject({ status: "failed", failed: { message: expect.not.stringContaining("force: true") } });
  });

  it("a forced delete is stale when the page changed after the plan", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "page.delete", path: OLD, force: true }));
    h.author.pages.set(OLD, { "jcr:title": "Old, edited" });
    expect(await h.apply({ token: plan.token, env: "stage", kind: "page.delete" })).toMatchObject({ status: "rejected", reason: "stale-plan" });
    expect(h.author.posts()).toEqual([]);
  });
});

describe("Live Copies and locks", () => {
  it("livecopy.create defaults to the Standard rollout config and explains inheritance", async () => {
    const h = harness();
    const plan = planned(await h.plan(CASES["livecopy.create"].operation));
    expect(plan.changes[0]?.after).toMatchObject({ master: PAGE, rolloutConfigs: ["/libs/msm/wcm/rolloutconfigs/default"], includeSubpages: true });
    expect(plan.warnings.join(" ")).toContain("cancel inheritance");
    await h.apply({ token: plan.token, env: "stage", kind: "livecopy.create" });
    expect(h.author.posts()[0]?.body).toContain("cmd=createLiveCopy");
  });

  it("livecopy.create refuses a taken name, an unknown rollout config and a destination outside the roots", async () => {
    const h = harness();
    expect(await h.plan({ kind: "livecopy.create", srcPath: PAGE, destParentPath: EN, name: "old", title: "x" })).toMatchObject({ reason: "already-exists" });
    expect(await h.plan({ kind: "livecopy.create", srcPath: PAGE, destParentPath: FR, name: "x", title: "x", rolloutConfigs: ["/apps/acme/x"] })).toMatchObject({
      reason: "invalid-operation",
    });
    expect(await h.plan({ kind: "livecopy.create", srcPath: PAGE, destParentPath: "/content/acme-demo-site-us/fr", name: "x", title: "x" })).toMatchObject({
      reason: "path-outside-write-roots",
    });
  });

  it("page.lock records the token's user and says the owner can still edit", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "page.lock", path: OLD }));
    expect(plan.changes).toEqual([{ path: OLD, what: "lock owner", before: undefined, after: h.author.currentUser.id }]);
    expect(plan.warnings.join(" ")).toContain("can still edit");
  });

  it("locking a page already locked by the token's user is a no-op; by someone else, a rejection", async () => {
    const h = harness();
    expect((await h.plan({ kind: "page.lock", path: LOCKED })).status).toBe("no-changes");
    h.author.pages.set(OLD, { "jcr:title": "Old", "jcr:lockOwner": "someone-else" });
    expect(await h.plan({ kind: "page.lock", path: OLD })).toMatchObject({ status: "rejected", reason: "locked-by-other" });
    expect(await h.plan({ kind: "page.unlock", path: OLD })).toMatchObject({ status: "rejected", reason: "locked-by-other", message: expect.stringContaining("someone-else") });
  });

  it("unlocking a page that is not locked is a no-op", async () => {
    const h = harness();
    expect((await h.plan({ kind: "page.unlock", path: OLD })).status).toBe("no-changes");
  });
});

describe("page.publish-tree", () => {
  it("publishes every page at or below the root, and nothing that only shares its prefix", async () => {
    const h = harness();
    h.author.pages.set(`${SYNTHETIC_ROOT}/en-gb`, { "jcr:title": "EN-GB" });
    const plan = planned(await h.plan({ kind: "page.publish-tree", root: EN, target: "both" }));
    const previewed = plan.changes.filter((change) => change.what === "preview").map((change) => change.path);
    expect(previewed.sort()).toEqual([EN, LOCKED, OLD, PAGE].sort());
    expect(plan.summary).toContain("4 pages");
  });

  it("refuses a root outside the write roots", async () => {
    const h = harness();
    expect(await h.plan({ kind: "page.publish-tree", root: "/content/acme-demo-site-us/en", target: "both" })).toMatchObject({ reason: "path-outside-write-roots" });
  });
});

describe("livecopy.set-rollout-configs", () => {
  it("replaces the configs of a Live Copy root, shows before/after and warns about Push on modify", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "livecopy.set-rollout-configs", path: LIVE_COPY, rolloutConfigs: [DEFAULT_CONFIG, PUSH_ON_MODIFY] }));
    expect(plan.changes).toEqual([{ path: LIVE_COPY, what: "rollout configs", before: [DEFAULT_CONFIG], after: [DEFAULT_CONFIG, PUSH_ON_MODIFY] }]);
    expect(plan.warnings).toContain(PUSH_ON_MODIFY_WARNING);
    expect(plan.requests).toEqual([{ method: "POST", path: `${LIVE_COPY}/jcr:content/cq:LiveSyncConfig`, label: expect.stringContaining(PUSH_ON_MODIFY) }]);
    expect(await h.apply({ token: plan.token, env: "stage", kind: "livecopy.set-rollout-configs" })).toMatchObject({ status: "applied" });
    expect(h.author.posts()[0]?.body).toBe(
      `_charset_=utf-8&cq%3ArolloutConfigs=${encodeURIComponent(DEFAULT_CONFIG)}&cq%3ArolloutConfigs=${encodeURIComponent(PUSH_ON_MODIFY)}&cq%3ArolloutConfigs%40TypeHint=String%5B%5D`,
    );
    expect(await h.plan({ kind: "livecopy.set-rollout-configs", path: LIVE_COPY, rolloutConfigs: [DEFAULT_CONFIG, PUSH_ON_MODIFY] })).toMatchObject({ status: "no-changes" });
  });

  it("does not warn about Push on modify when the new configs leave it out", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "livecopy.set-rollout-configs", path: LIVE_COPY, rolloutConfigs: ["/libs/msm/wcm/rolloutconfigs/activate"] }));
    expect(plan.warnings).not.toContain(PUSH_ON_MODIFY_WARNING);
  });

  it("refuses a page that is not a Live Copy root, a missing page and an unknown config", async () => {
    const h = harness();
    expect(await h.plan({ kind: "livecopy.set-rollout-configs", path: OLD, rolloutConfigs: [DEFAULT_CONFIG] })).toMatchObject({ status: "rejected", reason: "invalid-operation" });
    expect(await h.plan({ kind: "livecopy.set-rollout-configs", path: `${FR}/missing`, rolloutConfigs: [DEFAULT_CONFIG] })).toMatchObject({ status: "rejected", reason: "not-found" });
    expect(await h.plan({ kind: "livecopy.set-rollout-configs", path: LIVE_COPY, rolloutConfigs: ["/apps/acme/x"] })).toMatchObject({ status: "rejected" });
    expect(h.author.posts()).toEqual([]);
  });
});

describe("livecopy.rollout", () => {
  const TARGET = `${FR}/gear-live`;

  it("waits until the async job reaches every target, so a later batch operation sees the rolled-out content", async () => {
    const h = harness();
    h.author.pages.set(TARGET, { ...h.author.pages.get(TARGET), "cq:lastRolledout": "before" });
    const plan = planned(await h.plan({ kind: "livecopy.rollout", path: PAGE, targets: [TARGET] }));
    expect(plan.summary).toContain(`Roll out ${PAGE} to 1 Live Copy`);
    expect(plan.warnings).toContain(ROLLOUT_WARNING);
    expect(await h.apply({ token: plan.token, env: "stage", kind: "livecopy.rollout" })).toMatchObject({ status: "applied" });
    expect(h.author.pages.get(TARGET)?.["cq:lastRolledout"]).not.toBe("before");
  });

  it("fails naming the targets the job never reached", async () => {
    const h = harness();
    h.author.rollout.delivers = false;
    const plan = planned(await h.plan({ kind: "livecopy.rollout", path: PAGE, targets: [TARGET] }));
    const result = await h.apply({ token: plan.token, env: "stage", kind: "livecopy.rollout" });
    expect(result).toMatchObject({ status: "failed", failed: { message: expect.stringContaining(`has not reached ${TARGET}`) } });
    expect(h.author.sleeps.filter((ms) => ms === ROLLOUT_POLL_MS)).toHaveLength(ROLLOUT_TIMEOUT_MS / ROLLOUT_POLL_MS);
  });

  it("rejects a target that does not exist, at plan time", async () => {
    const h = harness();
    expect(await h.plan({ kind: "livecopy.rollout", path: PAGE, targets: [`${FR}/missing`] })).toMatchObject({ status: "rejected", reason: "not-found" });
  });
});

describe("batch", () => {
  const OPS: SinglePlanOperation[] = [
    { kind: "page.set-properties", path: OLD, set: { "jcr:title": "Older" } },
    { kind: "page.delete", path: OLD, force: true },
  ];

  it("plans without reading or writing, lists every operation and lives longer than a single plan", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "batch", operations: OPS }));
    expect(h.author.posts()).toEqual([]);
    expect(plan.summary).toContain("2 operations");
    expect(plan.confirmationMessage).toContain(`1. page.set-properties ${OLD}`);
    expect(plan.confirmationMessage).toContain(`2. page.delete ${OLD}`);
    expect(plan.confirmationMessage).toContain("force");
    expect(new Date(plan.expiresAt).getTime()).toBe(BATCH_TTL_MS);
    h.advance(TTL);
    expect((await h.apply({ token: plan.token, env: "stage", kind: "batch" })).status).toBe("applied");
  });

  it("applies the operations in order, each planned against the state at that moment", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "batch", operations: OPS }));
    const result = await h.apply({ token: plan.token, env: "stage", kind: "batch" });
    expect(result).toMatchObject({ status: "applied", operations: [{ index: 1, kind: "page.set-properties", sent: 1, ok: 1 }, { index: 2, kind: "page.delete", sent: 1, ok: 1 }] });
    expect(h.author.posts().map((r) => r.path)).toEqual([`${OLD}/jcr:content`, "/bin/wcmcommand"]);
  });

  it("stops at the first operation that is rejected or fails, and runs nothing after it", async () => {
    const h = harness();
    const plan = planned(
      await h.plan({
        kind: "batch",
        operations: [OPS[0] as SinglePlanOperation, { kind: "page.set-properties", path: `${EN}/missing`, set: { "jcr:title": "x" } }, OPS[1] as SinglePlanOperation],
      }),
    );
    const result = await h.apply({ token: plan.token, env: "stage", kind: "batch" });
    expect(result).toMatchObject({ status: "failed", failed: { index: 2, kind: "page.set-properties", message: expect.stringContaining("no page") }, notRun: 1 });
    expect(h.author.posts()).toHaveLength(1);
  });

  it("retries an operation that does not find what an earlier one just wrote, then fails", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "batch", operations: [{ kind: "page.set-properties", path: `${EN}/missing`, set: { "jcr:title": "x" } }] }));
    const result = await h.apply({ token: plan.token, env: "stage", kind: "batch" });
    expect(result).toMatchObject({ status: "failed", failed: { index: 1, message: expect.stringContaining("not-found") } });
    expect(h.author.sleeps).toEqual(Array.from({ length: BATCH_READ_RETRIES }, () => BATCH_READ_RETRY_MS));
  });

  it("reports growing progress before each operation and after each request, and ignores a client that cannot take it", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "batch", operations: OPS }));
    const reports: { progress: number; total: number | undefined; message: string }[] = [];
    const result = await applyPlan(
      {
        config: h.config,
        clientFor: () => h.author.client,
        store: h.store,
        sleep: async () => {},
        reportProgress: async (progress, total, message) => {
          reports.push({ progress, total, message });
          throw new Error("client gone");
        },
      },
      { token: plan.token, env: "stage", kind: "batch" },
    );
    expect(result.status).toBe("applied");
    expect(reports.map((r) => r.progress)).toEqual([0, 1, 2]);
    expect(reports.every((r) => r.total === 2)).toBe(true);
    expect(reports[0]?.message).toBe("operation 1/2: page.set-properties");
  });

  it("an operation with nothing to change is skipped, not a failure", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "batch", operations: [{ kind: "page.set-properties", path: OLD, set: { "jcr:title": "Old" } }] }));
    expect(await h.apply({ token: plan.token, env: "stage", kind: "batch" })).toMatchObject({ status: "applied", operations: [{ index: 1, sent: 0, skipped: true }] });
  });

  it("rejects at plan time what the guards reject, naming the operation", async () => {
    const h = harness();
    const result = await h.plan({ kind: "batch", operations: [OPS[0] as SinglePlanOperation, { kind: "page.delete", path: "/content/acme-demo-site-us/en" }] });
    expect(result).toMatchObject({ status: "rejected", reason: "path-outside-write-roots", message: expect.stringContaining("operation 2") });
  });

  it("keeps the token matrix: forged, reused and mismatched echoes write nothing", async () => {
    const h = harness();
    const plan = planned(await h.plan({ kind: "batch", operations: OPS }));
    expect(await h.apply({ token: "forged", env: "stage", kind: "batch" })).toMatchObject({ reason: "unknown-token" });
    expect(await h.apply({ token: plan.token, env: "stage", kind: "page.delete" })).toMatchObject({ reason: "kind-mismatch" });
    expect(await h.apply({ token: plan.token, env: "prod", kind: "batch" })).toMatchObject({ reason: "env-mismatch" });
    expect(h.author.posts()).toEqual([]);
    await h.apply({ token: plan.token, env: "stage", kind: "batch" });
    expect(await h.apply({ token: plan.token, env: "stage", kind: "batch" })).toMatchObject({ reason: "already-applied" });
  });

  it("asks for the typed target when an operation touches a protected path", async () => {
    const h = harness({ AEM_PROTECTED_PATHS: "/content/*/en" });
    const plan = planned(await h.plan({ kind: "batch", operations: [{ kind: "page.set-properties", path: EN, set: { "jcr:title": "x" } }] }));
    expect(plan.requiresConfirmTarget).toBe(true);
    expect(await h.plan({ kind: "batch", operations: [{ kind: "page.publish", paths: [EN], target: "preview" }] })).toMatchObject({ reason: "protected-path-publish" });
  });
});
