// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `eds_plan` (eds-write-surface design.md, Decisions 1–4, 6–8). Reads what
// the operation depends on, records the exact write requests, fingerprints
// the state the user reviews, assembles the confirmation message and stores
// the plan under a one-time token. It never writes: every client call here
// is a read, and the writes are only BUILT (`writeRequests`), never sent.
import { AdminApiAuthError, writeRequests, type EdsClient, type PlannedRequest } from "../client/index.js";
import { fingerprint } from "../confirm/fingerprint.js";
import { diffDocuments, mergeConfigPatch, type ConfigChange } from "../confirm/merge-patch.js";
import type { PlanStore } from "../confirm/plan-store.js";
import { matchesSitePattern } from "../confirm/protected-sites.js";
import type { EdsPlanInput, OperationKind, PlanOperation } from "./plan.js";
import { redactChange, redactValue } from "./redact-output.js";

/** Returned in every planned result: a model weighs what it just received more than a description read at session start (Decision 4). */
export const PLAN_INSTRUCTION =
  "Show confirmationMessage to the user, translated into the user's language if needed, without summarising the changes away. " +
  "Call eds_apply only if the user's most recent message explicitly confirms this plan, passing this token with this plan's site and kind. " +
  "If the user asks for any modification, call eds_plan again; do not reuse this token.";

/** How `eds_apply` re-checks the state the user reviewed (Decision 3). */
export type Fingerprint =
  | { readonly read: "site-document" | "robots"; readonly sha256: string }
  | { readonly read: "site-absent" };

/** What the store keeps under a token. Opaque to the store itself. */
export interface StoredPlan {
  /** The org the plan was built for; `eds_apply` re-reads under it. */
  readonly org: string;
  readonly site: string;
  readonly kind: OperationKind;
  readonly requests: readonly PlannedRequest[];
  readonly fingerprint?: Fingerprint;
  readonly protected: boolean;
  /** The writes answer with a job (`links.self`) that `wait: true` can follow. */
  readonly jobBacked: boolean;
  readonly previousVersionId?: string;
}

export type PlanResult =
  | { readonly status: "no-changes"; readonly site: string; readonly summary: string }
  | {
      readonly status: "planned";
      readonly token: string;
      /** ISO 8601. */
      readonly expiresAt: string;
      readonly site: string;
      readonly kind: OperationKind;
      readonly summary: string;
      readonly changes?: readonly ConfigChange[];
      readonly requests: readonly { readonly method: string; readonly path: string }[];
      readonly warnings: readonly string[];
      readonly confirmationMessage: string;
      readonly instruction: string;
      readonly requiresConfirmSite: boolean;
    };

export interface PlanDeps {
  readonly client: EdsClient;
  readonly org: string;
  readonly store: PlanStore<StoredPlan>;
  readonly protectedSites: readonly string[];
}

const REF_KINDS: ReadonlySet<OperationKind> = new Set([
  "preview.update",
  "preview.delete",
  "live.publish",
  "live.unpublish",
  "index.update",
  "index.delete",
  "index.full-site",
  "cache.purge",
  "sitemap.rebuild",
  "code.sync",
  "code.delete",
  "job.stop",
]);

const AEM_DELIVERY_MARKER = "/bin/franklin.delivery";
const AEM_WARNING =
  "The content source is AEM: previewing or publishing through the Admin API leaves no replication record in AEM, " +
  "so the author will not show these pages as published. Publish from AEM instead when an audit trail is required.";
const AEM_UNCHECKED_WARNING =
  "The site configuration could not be read with this key (it needs config_admin), so whether the content source is AEM was not checked. " +
  "If it is, previewing or publishing here leaves no replication record in AEM.";
const FULL_SITE_WARNING =
  "This is a full-site reindex: every published page of the site is reindexed. It is resource-intensive and cannot be narrowed once started.";

/** A plan the server refuses to build: nothing is stored and no token is issued. */
export class PlanRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanRefusedError";
  }
}

/** What one kind contributes before the shared assembly. `undefined` changes = not a config kind. */
interface Draft {
  readonly summary: string;
  readonly requests: readonly PlannedRequest[];
  readonly warnings?: readonly string[];
  readonly changes?: readonly ConfigChange[];
  readonly details?: readonly string[];
  readonly fingerprint?: Fingerprint;
  readonly jobBacked?: boolean;
  readonly previousVersionId?: string;
  /** True when the operation would change nothing — no token is issued. */
  readonly noChanges?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isAemSource(document: unknown): boolean {
  const source = isRecord(document) && isRecord(document.content) ? document.content.source : undefined;
  return isRecord(source) && source.type === "markup" && typeof source.url === "string" && source.url.includes(AEM_DELIVERY_MARKER);
}

function secretsWarnings(document: unknown): string[] {
  if (!isRecord(document)) return [];
  return ["secrets", "tokens"]
    .filter((key) => isRecord(document[key]) && Object.keys(document[key]).length > 0)
    .map(
      (key) =>
        `The site document has a non-empty "${key}" entry. This plan sends the whole document back as read, ` +
        `so it relies on the Admin API returning "${key}" intact on read (not yet verified against a live tenant).`,
    );
}

function repositoryOf(document: unknown, site: string): { readonly owner: string; readonly repo: string } {
  const code = isRecord(document) ? document.code : undefined;
  if (isRecord(code) && typeof code.owner === "string" && code.owner.length > 0 && typeof code.repo === "string" && code.repo.length > 0) {
    return { owner: code.owner, repo: code.repo };
  }
  throw new PlanRefusedError(`The site document of ${site} names no repository (code.owner and code.repo), so code operations cannot be planned for it.`);
}

/** `current` from the versions list, best effort: a failed read only costs the rollback hint. */
async function currentVersionId(deps: PlanDeps, site: string): Promise<{ id?: string; warning?: string }> {
  try {
    const versions = await deps.client.operations.siteConfig.listConfigVersions({ org: deps.org, site });
    return versions.current === undefined ? {} : { id: String(versions.current) };
  } catch {
    return { warning: "The configuration versions could not be read, so no previous version is reported for rollback." };
  }
}

/**
 * The AEM check is advisory, and the site document needs `config_admin`,
 * which a day-to-day `publish, author` key does not carry (README, "Roles").
 * So a 403 there skips the check, saying so, instead of blocking the plan.
 * Any other failure — including a 401, where the writes would fail too — still
 * stops it.
 */
async function aemSourceWarnings(deps: PlanDeps, site: string): Promise<string[]> {
  try {
    return isAemSource(await readSiteDocument(deps, site)) ? [AEM_WARNING] : [];
  } catch (error) {
    if (error instanceof AdminApiAuthError && error.status === 403) return [AEM_UNCHECKED_WARNING];
    throw error;
  }
}

async function readSiteDocument(deps: PlanDeps, site: string): Promise<unknown> {
  return deps.client.operations.siteConfig.getSiteDocument({ org: deps.org, site });
}

function contentWrites(
  resource: "preview" | "live",
  remove: boolean,
  address: { org: string; site: string; ref: string },
  paths: readonly string[],
): { requests: PlannedRequest[]; jobBacked: boolean } {
  if (paths.length === 1) {
    return { requests: [writeRequests.contentPath(resource, remove ? "DELETE" : "POST", { ...address, path: paths[0]! })], jobBacked: false };
  }
  return { requests: [writeRequests.contentBulk(resource, { ...address, paths, remove })], jobBacked: true };
}

async function draftFor(deps: PlanDeps, site: string, ref: string, operation: PlanOperation): Promise<Draft> {
  const params = { org: deps.org, site };
  const address = { ...params, ref };
  switch (operation.kind) {
    case "config.patch": {
      const document = await readSiteDocument(deps, site);
      const merged = mergeConfigPatch(document, operation.patch);
      const changes = diffDocuments(document, merged);
      if (changes.length === 0) return { summary: `No change to the configuration of ${site}`, requests: [], noChanges: true };
      const version = await currentVersionId(deps, site);
      return {
        summary: `Update the configuration of ${site} (${plural(changes.length, "change")})`,
        requests: [writeRequests.siteUpdate(params, merged)],
        changes,
        warnings: [...secretsWarnings(document), ...(version.warning !== undefined ? [version.warning] : [])],
        fingerprint: { read: "site-document", sha256: fingerprint(document) },
        ...(version.id !== undefined ? { previousVersionId: version.id } : {}),
      };
    }
    case "site.create": {
      if (await deps.client.operations.siteConfig.siteExists(params)) {
        throw new PlanRefusedError(`Site ${site} already exists in ${deps.org}; use config.patch to change it.`);
      }
      return {
        summary: `Create site ${site}`,
        requests: [writeRequests.siteCreate(params, operation.config)],
        changes: diffDocuments({}, operation.config),
        fingerprint: { read: "site-absent" },
      };
    }
    case "site.delete": {
      const document = await readSiteDocument(deps, site);
      return {
        summary: `Delete site ${site}`,
        requests: [writeRequests.siteDelete(params)],
        warnings: [`This deletes the configuration of ${site}; the site stops being served from it.`],
        fingerprint: { read: "site-document", sha256: fingerprint(document) },
      };
    }
    case "version.restore": {
      const document = await readSiteDocument(deps, site);
      const version = await currentVersionId(deps, site);
      return {
        summary: `Restore configuration version ${operation.versionId} of ${site}`,
        requests: [writeRequests.versionRestore({ ...params, versionId: operation.versionId })],
        warnings: version.warning !== undefined ? [version.warning] : [],
        fingerprint: { read: "site-document", sha256: fingerprint(document) },
        ...(version.id !== undefined ? { previousVersionId: version.id } : {}),
      };
    }
    case "robots.set": {
      const current = await deps.client.operations.robots.getRobots(params);
      if (current === operation.content) return { summary: `robots.txt of ${site} already has this content`, requests: [], noChanges: true };
      return {
        summary: `Replace robots.txt of ${site}`,
        requests: [writeRequests.robotsSet({ ...params, content: operation.content })],
        details: ["robots.txt now:", indent(redact(current)), "robots.txt after:", indent(redact(operation.content))],
        fingerprint: { read: "robots", sha256: fingerprint(current) },
      };
    }
    case "preview.update":
    case "preview.delete":
    case "live.publish":
    case "live.unpublish": {
      const resource = operation.kind.startsWith("preview") ? "preview" : "live";
      const remove = operation.kind === "preview.delete" || operation.kind === "live.unpublish";
      const aemWarnings = await aemSourceWarnings(deps, site);
      const writes = contentWrites(resource, remove, address, operation.paths);
      const verb = { "preview.update": "Preview", "preview.delete": "Remove from preview", "live.publish": "Publish", "live.unpublish": "Unpublish" }[operation.kind];
      return {
        summary: `${verb} ${plural(operation.paths.length, "path")} on ${site}`,
        ...writes,
        details: pathDetails(operation.paths),
        warnings: [
          ...(remove ? [`This removes ${plural(operation.paths.length, "path")} from ${resource === "live" ? "the live site" : "preview"}.`] : []),
          ...aemWarnings,
        ],
      };
    }
    case "index.update": {
      const paths = operation.paths;
      const requests =
        paths.length === 1 ? [writeRequests.contentPath("index", "POST", { ...address, path: paths[0]! })] : [writeRequests.indexBulk({ ...address, paths })];
      return { summary: `Reindex ${plural(paths.length, "path")} on ${site}`, requests, jobBacked: paths.length > 1, details: pathDetails(paths) };
    }
    case "index.delete":
      return {
        summary: `Remove ${plural(operation.paths.length, "path")} from the index of ${site}`,
        requests: operation.paths.map((path) => writeRequests.contentPath("index", "DELETE", { ...address, path })),
        details: pathDetails(operation.paths),
        warnings: [`This removes ${plural(operation.paths.length, "path")} from the index.`],
      };
    case "index.full-site":
      return {
        summary: `Reindex every published page of ${site}`,
        requests: [writeRequests.indexFullSite(address)],
        warnings: [FULL_SITE_WARNING],
        jobBacked: true,
      };
    case "cache.purge":
      return {
        summary: `Purge the CDN cache for ${plural(operation.paths.length, "path")} on ${site}`,
        requests: operation.paths.map((path) => writeRequests.cachePurge({ ...address, path })),
        details: pathDetails(operation.paths),
      };
    case "sitemap.rebuild":
      return { summary: `Rebuild sitemap ${operation.path} of ${site}`, requests: [writeRequests.sitemapRebuild({ ...address, path: operation.path })] };
    case "code.sync":
    case "code.delete": {
      const repository = repositoryOf(await readSiteDocument(deps, site), site);
      const remove = operation.kind === "code.delete";
      return {
        summary: `${remove ? "Delete" : "Sync"} ${plural(operation.paths.length, "code path")} of ${site} from ${repository.owner}/${repository.repo}`,
        requests: operation.paths.map((path) => writeRequests.code(remove ? "DELETE" : "POST", { ...repository, ref, path })),
        details: [`Repository: ${repository.owner}/${repository.repo} (ref ${ref}), resolved from the site configuration`, ...pathDetails(operation.paths)],
        warnings: remove ? [`This removes ${plural(operation.paths.length, "file")} from the code bus.`] : [],
      };
    }
    case "job.stop":
      return {
        summary: `Stop job ${operation.topic}/${operation.name} on ${site}`,
        requests: [writeRequests.jobStop({ ...address, topic: operation.topic, name: operation.name })],
      };
    case "snapshot.add":
      return {
        summary: `Add ${operation.paths === undefined ? "no paths" : plural(operation.paths.length, "path")} to snapshot ${operation.id} of ${site}`,
        requests: [writeRequests.snapshotAdd({ ...params, id: operation.id, ...(operation.paths !== undefined ? { paths: operation.paths } : {}) })],
        details: operation.paths === undefined ? [] : pathDetails(operation.paths),
      };
    case "snapshot.remove":
      return {
        summary: `Remove ${plural(operation.paths.length, "path")} from snapshot ${operation.id} of ${site}`,
        requests: [writeRequests.snapshotRemove({ ...params, id: operation.id, paths: operation.paths })],
        details: pathDetails(operation.paths),
      };
    case "snapshot.publish":
      return {
        summary: `Publish snapshot ${operation.id} of ${site}`,
        requests: [writeRequests.snapshotPublish({ ...params, id: operation.id })],
        warnings: ["Publishing a snapshot makes every path in it live."],
      };
    case "snapshot.review":
      return {
        summary: `${operation.reviewAction === "approve" ? "Approve" : "Reject"} snapshot ${operation.id} of ${site}`,
        requests: [
          writeRequests.snapshotReview({
            ...params,
            id: operation.id,
            reviewAction: operation.reviewAction,
            ...(operation.message !== undefined ? { message: operation.message } : {}),
          }),
        ],
      };
    case "snapshot.delete":
      return {
        summary: `Delete snapshot ${operation.id} of ${site}`,
        requests: [writeRequests.snapshotDelete({ ...params, id: operation.id })],
        warnings: [`This deletes snapshot ${operation.id}.`],
      };
  }
}

function redact(text: string): string {
  return redactValue(text) as string;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function pathDetails(paths: readonly string[]): string[] {
  return ["Paths:", ...paths.map((path) => `  ${path}`)];
}

const MAX_VALUE_CHARS = 200;

function showValue(value: unknown): string {
  const text = JSON.stringify(value) ?? "null";
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
}

function showChange(change: ConfigChange): string {
  const before = "before" in change ? showValue(change.before) : "(absent)";
  const after = "after" in change ? showValue(change.after) : "(removed)";
  return `  ${change.pointer}: ${before} → ${after}`;
}

interface MessageParts {
  readonly org: string;
  readonly site: string;
  readonly summary: string;
  readonly changes?: readonly ConfigChange[];
  readonly details: readonly string[];
  readonly requests: readonly PlannedRequest[];
  readonly warnings: readonly string[];
  readonly protected: boolean;
}

/** Server-assembled, so the user sees the same message whichever model relays it (Decision 4). */
function confirmationMessage(parts: MessageParts): string {
  const lines = [`Plan for site "${parts.site}" in org ${parts.org}: ${parts.summary}.`];
  if (parts.changes !== undefined) lines.push("Changes:", ...parts.changes.map(showChange));
  lines.push(...parts.details);
  lines.push("Requests:", ...parts.requests.map((request) => `  ${request.method} ${request.path}`));
  if (parts.warnings.length > 0) lines.push("Warnings:", ...parts.warnings.map((warning) => `  - ${warning}`));
  lines.push(
    parts.protected
      ? `This site is protected. To apply this plan, reply with the site name "${parts.site}".`
      : 'Reply "yes" to apply this plan, or say what should change.',
  );
  return lines.join("\n");
}

export async function buildPlan(deps: PlanDeps, input: EdsPlanInput): Promise<PlanResult> {
  const { site, operation } = input;
  if (input.ref !== undefined && !REF_KINDS.has(operation.kind)) {
    throw new PlanRefusedError(`ref does not apply to ${operation.kind}: it is not addressed by branch. Plan it without ref.`);
  }
  const draft = await draftFor(deps, site, input.ref ?? "main", operation);
  if (draft.noChanges === true) return { status: "no-changes", site, summary: draft.summary };

  const isProtected = matchesSitePattern(site, deps.protectedSites);
  const warnings = [
    ...(isProtected ? [`${site} is a protected site (EDS_PROTECTED_SITES): applying requires repeating its name.`] : []),
    ...(draft.warnings ?? []),
  ];
  const changes = draft.changes?.map(redactChange);
  const stored: StoredPlan = {
    org: deps.org,
    site,
    kind: operation.kind,
    requests: draft.requests,
    protected: isProtected,
    jobBacked: draft.jobBacked ?? false,
    ...(draft.fingerprint !== undefined ? { fingerprint: draft.fingerprint } : {}),
    ...(draft.previousVersionId !== undefined ? { previousVersionId: draft.previousVersionId } : {}),
  };
  const issued = deps.store.issue(stored);
  return {
    status: "planned",
    token: issued.token,
    expiresAt: new Date(issued.expiresAt).toISOString(),
    site,
    kind: operation.kind,
    summary: draft.summary,
    ...(changes !== undefined ? { changes } : {}),
    requests: draft.requests.map((request) => ({ method: request.method, path: request.path })),
    warnings,
    confirmationMessage: confirmationMessage({
      org: deps.org,
      site,
      summary: draft.summary,
      ...(changes !== undefined ? { changes } : {}),
      details: draft.details ?? [],
      requests: draft.requests,
      warnings,
      protected: isProtected,
    }),
    instruction: PLAN_INSTRUCTION,
    requiresConfirmSite: isProtected,
  };
}
