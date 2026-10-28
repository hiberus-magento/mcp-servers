// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Write roots and protected-path matching (aem-sites-package design.md, D4.1
// and D5). The page-path grammar is deliberately narrower than JCR's: only
// `/segment/segment` with letters, digits, `_` and `-`. That single rule
// makes traversal (`..`), selectors and extensions (`.json`, `.html`),
// encoded slashes (`%2F`), query strings and empty segments unexpressible —
// no case needs its own check, because no dot, percent sign, `?` or `//`
// can get through the grammar at all.
export class InvalidAemPathError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(
      `Invalid AEM page path "${path}": expected /segment/segment… with only letters, digits, "_" and "-" (no dots, selectors, extensions, "..", "//" or encoded characters).`,
    );
    this.name = "InvalidAemPathError";
    this.path = path;
  }
}

export class PathOutsideWriteRootsError extends Error {
  readonly path: string;
  readonly roots: readonly string[];

  constructor(path: string, roots: readonly string[]) {
    super(
      roots.length === 0
        ? `No write roots are configured, so "${path}" cannot be written. Set AEM_WRITE_ROOTS (see docs/aem-sites-onboarding.md).`
        : `"${path}" is outside the configured write roots (${roots.join(", ")}).`,
    );
    this.name = "PathOutsideWriteRootsError";
    this.path = path;
    this.roots = roots;
  }
}

export class InvalidWriteRootError extends Error {
  constructor(root: string, reason: string) {
    super(`Invalid AEM_WRITE_ROOTS entry "${root}": ${reason}.`);
    this.name = "InvalidWriteRootError";
  }
}

export class InvalidPathPatternError extends Error {
  constructor(pattern: string) {
    super(`Invalid AEM_PROTECTED_PATHS entry "${pattern}": expected /segment/… where a segment may be "*" (one whole segment).`);
    this.name = "InvalidPathPatternError";
  }
}

const PAGE_PATH = /^(?:\/[A-Za-z0-9_-]+)+$/;
const PATTERN_PATH = /^(?:\/(?:[A-Za-z0-9_-]+|\*))+$/;

/** Roots no configuration can open: code, configuration, users, runtime state and assets. */
const FORBIDDEN_ROOTS = ["/content/dam"] as const;

/** Returns `path` unchanged when it matches the page-path grammar, otherwise throws. */
export function assertAemPath(path: string): string {
  if (!PAGE_PATH.test(path)) {
    throw new InvalidAemPathError(path);
  }
  return path;
}

export class PathNotReadableError extends Error {
  constructor(path: string) {
    super(`"${path}" cannot be read through this server: reads are limited to site content under /content/ (not /content/dam).`);
    this.name = "PathNotReadableError";
  }
}

/** Reads are not limited to the write roots, but they stay inside site content: never /home, /apps, /var or assets. */
export function assertReadable(path: string): string {
  assertAemPath(path);
  if (!path.startsWith("/content/") || FORBIDDEN_ROOTS.some((forbidden) => isUnderRoot(path, forbidden))) {
    throw new PathNotReadableError(path);
  }
  return path;
}

export function isUnderRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Parses `AEM_WRITE_ROOTS`. Every root must be a valid page path strictly
 * under `/content/`, and never `/content/dam` or below. An invalid entry is a
 * configuration error raised once at startup, not per call.
 */
export function parseWriteRoots(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const roots: string[] = [];
  for (const entry of raw.split(",")) {
    const root = entry.trim();
    if (root === "") {
      continue;
    }
    if (!PAGE_PATH.test(root)) {
      throw new InvalidWriteRootError(root, "not a valid page path");
    }
    if (!root.startsWith("/content/")) {
      throw new InvalidWriteRootError(root, "every write root must be under /content/");
    }
    if (FORBIDDEN_ROOTS.some((forbidden) => isUnderRoot(root, forbidden))) {
      throw new InvalidWriteRootError(root, "assets (/content/dam) are out of scope");
    }
    if (!roots.includes(root)) {
      roots.push(root);
    }
  }
  return roots;
}

/** Throws unless `path` is a valid page path at or below one of `roots`. */
export function assertWritable(path: string, roots: readonly string[]): string {
  assertAemPath(path);
  if (!roots.some((root) => isUnderRoot(path, root))) {
    throw new PathOutsideWriteRootsError(path, roots);
  }
  return path;
}

export function parsePathPatterns(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const patterns: string[] = [];
  for (const entry of raw.split(",")) {
    const pattern = entry.trim();
    if (pattern === "") {
      continue;
    }
    if (!PATTERN_PATH.test(pattern)) {
      throw new InvalidPathPatternError(pattern);
    }
    patterns.push(pattern);
  }
  return patterns;
}

function segmentsMatch(pattern: readonly string[], path: readonly string[]): boolean {
  return pattern.length === path.length && pattern.every((segment, index) => segment === "*" || segment === path[index]);
}

/**
 * The first pattern that `path` or one of its ancestors matches exactly,
 * segment by segment (`*` stands for one whole segment). A protected page
 * protects everything below it.
 */
export function protectedPatternFor(path: string, patterns: readonly string[]): string | undefined {
  const segments = path.split("/").slice(1);
  for (const pattern of patterns) {
    const patternSegments = pattern.split("/").slice(1);
    if (patternSegments.length <= segments.length && segmentsMatch(patternSegments, segments.slice(0, patternSegments.length))) {
      return pattern;
    }
  }
  return undefined;
}

export class InvalidRolloutConfigError extends Error {
  constructor(config: string, reason: string) {
    super(`Rollout config "${config}" ${reason}.`);
    this.name = "InvalidRolloutConfigError";
  }
}

/** The MSM rollout configs AEM ships (observed on a live author, 2026-10-28). */
export const BUILTIN_ROLLOUT_CONFIGS: readonly string[] = [
  "/libs/msm/wcm/rolloutconfigs/default",
  "/libs/msm/wcm/rolloutconfigs/pushonmodify",
  "/libs/msm/wcm/rolloutconfigs/activate",
  "/libs/msm/wcm/rolloutconfigs/deactivate",
];

/** `AEM_EXTRA_ROLLOUT_CONFIGS`: a project's own rollout configs, exact paths under /apps/msm or /conf. */
export function parseRolloutConfigs(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  const configs: string[] = [];
  for (const entry of raw.split(",")) {
    const config = entry.trim();
    if (config === "") {
      continue;
    }
    if (!PAGE_PATH.test(config) || !(config.startsWith("/apps/msm/") || config.startsWith("/conf/"))) {
      throw new InvalidRolloutConfigError(config, "is not a page-path-shaped node under /apps/msm/ or /conf/");
    }
    if (!configs.includes(config)) {
      configs.push(config);
    }
  }
  return configs;
}

export function assertRolloutConfig(config: string, extra: readonly string[]): string {
  if (!BUILTIN_ROLLOUT_CONFIGS.includes(config) && !extra.includes(config)) {
    throw new InvalidRolloutConfigError(config, `is not allowed; use one of ${[...BUILTIN_ROLLOUT_CONFIGS, ...extra].join(", ")}`);
  }
  return config;
}
