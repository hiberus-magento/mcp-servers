// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// aem-sites-mcp spec: "Every Write Goes Through aem_plan and aem_apply",
// "Plan Result Is Self-Describing", "Write Roots", "Property Allowlist and
// Operator Ban", "Protected Environments and Paths", "Delete Refuses
// Published Content". The token matrix runs for EVERY operation kind.
import { describe, expect, it } from "vitest";
import { parseConfig, type AemConfig } from "../config.js";
import { createPlanStore } from "../confirm/plan-store.js";
import { SYNTHETIC_AEM_AUTHOR, SYNTHETIC_ROOT } from "../testing/author-double.js";
import { createFakeAuthor, type FakeAuthor } from "../testing/fake-author.js";
import { applyPlan, type ApplyResult } from "./apply.js";
import { AGENT_PAUSE_MS, EDS_LIVE_WARNING, planOperation, type PlanResult, type StoredPlan } from "./plan-builder.js";
import { OPERATION_KINDS, type AemApplyInput, type OperationKind, type PlanOperation } from "./plan-schema.js";

const EN = `${SYNTHETIC_ROOT}/en`;
const FR = `${SYNTHETIC_ROOT}/fr`;
const PAGE = `${EN}/outdoor-gear`;
const OLD = `${EN}/old`;
const LOCKED = `${EN}/locked`;
const SHEET = `${SYNTHETIC_ROOT}/metadata`;
const FR_SHEET = `${FR}/metadata`;
const TTL = 1_000;

function seed(author: FakeAuthor): void {
  author.pages.set(EN, { "jcr:title": "EN" });
  author.pages.set(FR, { "jcr:title": "FR" });
  author.pages.set(PAGE, { "jcr:title": "Outdoor gear", "cq:lastReplicationAction": "Activate", "cq:lastModified": "1" });
  author.pages.set(OLD, { "jcr:title": "Old" });
  author.pages.set(LOCKED, { "jcr:title": "Locked", "jcr:lockOwner": author.currentUser.id });
  author.sheets.set(FR_SHEET, {
    "jcr:primaryType": "cq:PageContent",
    columns: ["url", "Robots"],
    row: { "jcr:primaryType": "nt:unstructured", url: "/**", Robots: "noindex, nofollow" },
  });
}

interface Harness {
  readonly author: FakeAuthor;
  readonly config: AemConfig;
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
const CASES: Record<OperationKind, { readonly operation: PlanOperation; readonly stale: (author: FakeAuthor) => void }> = {
  "page.set-properties": {
    operation: { kind: "page.set-properties", path: PAGE, set: { "jcr:title": "Gear" } },
    stale: (a) => a.pages.set(PAGE, { ...a.pages.get(PAGE), "jcr:title": "Edited meanwhile" }),
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
    expect(Object.keys(CASES).sort()).toEqual([...OPERATION_KINDS].sort());
  });

  for (const kind of OPERATION_KINDS) {
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
