// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The page-property allowlist and the Sling POST operator ban
// (aem-sites-package design.md, D4.2 and D4.3). The Sling POST servlet
// treats parts of a field NAME as instructions — `name@MoveFrom`,
// `name@CopyFrom`, `name@Delete`, `:operation`, `:redirect` — so a property
// name is never passed through: it must be one of a closed set, and anything
// carrying `@` or starting with `:` is refused even if configuration lists
// it. The few operators the client needs (`@TypeHint`, `@Delete`,
// `:operation=delete`) are emitted only as constants by `client/builders.ts`.
export class ForbiddenPropertyNameError extends Error {
  readonly property: string;

  constructor(property: string, reason: string) {
    super(`Property "${property}" cannot be written: ${reason}.`);
    this.name = "ForbiddenPropertyNameError";
    this.property = property;
  }
}

export class InvalidPropertyValueError extends Error {
  constructor(property: string, reason: string) {
    super(`Invalid value for "${property}": ${reason}.`);
    this.name = "InvalidPropertyValueError";
  }
}

export class InvalidExtraPropertyError extends Error {
  constructor(property: string, reason: string) {
    super(`Invalid AEM_EXTRA_PROPERTIES entry "${property}": ${reason}.`);
    this.name = "InvalidExtraPropertyError";
  }
}

/** Page properties any plan may write (page-properties dialog fields used by Sites and EDS). */
export const BUILTIN_PAGE_PROPERTIES: readonly string[] = [
  "jcr:title",
  "jcr:description",
  // Fields of the EDS XWalk `page-metadata` model, stored on jcr:content.
  "robots",
  "keywords",
  "pageTitle",
  "navTitle",
  "hideInNav",
  "cq:robotsTags",
  "cq:tags",
  "cq:canonicalUrl",
  "sling:alias",
  "cq:redirectTarget",
];

/** Structural, security or bookkeeping properties: never writable, never configurable. */
const NEVER_WRITABLE = new Set([
  "jcr:primaryType",
  "jcr:mixinTypes",
  "jcr:uuid",
  "sling:resourceType",
  "sling:resourceSuperType",
  "cq:template",
  "cq:lastModified",
  "cq:lastModifiedBy",
  "jcr:created",
  "jcr:createdBy",
  "jcr:lastModified",
  "jcr:lastModifiedBy",
]);
const NEVER_WRITABLE_PREFIXES = ["rep:", "cq:lastReplicat", "cq:lastRolledout", "jcr:lock", "oak:", "sling:"] as const;

const PROPERTY_NAME = /^[A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z][A-Za-z0-9_-]*)?$/;

const ROBOTS_TOKENS = ["index", "noindex", "follow", "nofollow", "noarchive", "nosnippet", "noimageindex", "notranslate"] as const;
export type RobotsToken = (typeof ROBOTS_TOKENS)[number];
export const ALLOWED_ROBOTS_TOKENS: readonly RobotsToken[] = ROBOTS_TOKENS;

const MAX_STRING_LENGTH = 10_000;
const MAX_ARRAY_LENGTH = 100;

export type PropertyValue = string | number | boolean | readonly string[];

function structuralReason(name: string): string | undefined {
  if (name.includes("@")) {
    return 'a name containing "@" is a Sling POST operator';
  }
  if (name.startsWith(":")) {
    return 'a name starting with ":" is a Sling POST operator';
  }
  if (NEVER_WRITABLE.has(name) || NEVER_WRITABLE_PREFIXES.some((prefix) => name.startsWith(prefix) && !BUILTIN_PAGE_PROPERTIES.includes(name))) {
    return "structural, security or bookkeeping property";
  }
  if (!PROPERTY_NAME.test(name)) {
    return "not a valid property name";
  }
  return undefined;
}

/** Parses `AEM_EXTRA_PROPERTIES`: exact names only, each a plain property a project adds to its page dialog. */
export function parseExtraProperties(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const names: string[] = [];
  for (const entry of raw.split(",")) {
    const name = entry.trim();
    if (name === "") {
      continue;
    }
    const reason = structuralReason(name);
    if (reason !== undefined) {
      throw new InvalidExtraPropertyError(name, reason);
    }
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

export function assertWritableProperty(name: string, extra: readonly string[]): string {
  const reason = structuralReason(name);
  if (reason !== undefined) {
    throw new ForbiddenPropertyNameError(name, reason);
  }
  if (!BUILTIN_PAGE_PROPERTIES.includes(name) && !extra.includes(name)) {
    throw new ForbiddenPropertyNameError(name, "not in the page-property allowlist (add it to AEM_EXTRA_PROPERTIES if your page dialog defines it)");
  }
  return name;
}

export function assertPropertyValue(name: string, value: unknown): PropertyValue {
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      throw new InvalidPropertyValueError(name, `longer than ${MAX_STRING_LENGTH} characters`);
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InvalidPropertyValueError(name, "not a finite number");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      throw new InvalidPropertyValueError(name, `more than ${MAX_ARRAY_LENGTH} entries`);
    }
    if (!value.every((entry): entry is string => typeof entry === "string" && entry.length <= MAX_STRING_LENGTH)) {
      throw new InvalidPropertyValueError(name, "a list may contain only strings");
    }
    return value;
  }
  throw new InvalidPropertyValueError(name, "expected a string, number, boolean or list of strings");
}

export function assertRobotsTokens(tokens: readonly string[]): readonly RobotsToken[] {
  const allowed = new Set<string>(ROBOTS_TOKENS);
  const invalid = tokens.filter((token) => !allowed.has(token));
  if (invalid.length > 0 || tokens.length === 0) {
    throw new InvalidPropertyValueError("robots", `expected one or more of ${ROBOTS_TOKENS.join(", ")}`);
  }
  return [...new Set(tokens)] as RobotsToken[];
}

/**
 * Sheet column names become property names on row nodes, so they are plain
 * words only: no `:` (no namespace, so nothing structural), no `@`, no `/`.
 */
const SHEET_COLUMN = /^[A-Za-z][A-Za-z0-9 _-]{0,63}$/;

export function assertSheetColumn(name: string): string {
  if (!SHEET_COLUMN.test(name)) {
    throw new ForbiddenPropertyNameError(name, "a sheet column must be a plain word of letters, digits, spaces, '_' or '-'");
  }
  return name;
}
