// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// `config.patch` semantics (eds-write-surface design.md, Decision 8):
// RFC 7386 JSON Merge Patch, and the JSON Pointer (RFC 6901) diff the plan
// shows the user. Pure functions; no dependency.
import { canonicalJson } from "./fingerprint.js";

export class InvalidConfigPatchError extends Error {
  constructor() {
    super("A config.patch patch must be a JSON object; arrays, scalars and null are not accepted.");
    this.name = "InvalidConfigPatchError";
  }
}

/** One changed key. `before` is absent for an added key, `after` for a removed one. */
export interface ConfigChange {
  readonly pointer: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// Plain assignment of `__proto__` would replace the prototype instead of
// storing the key; a patch parsed from JSON can carry one as data.
function setOwn(object: JsonObject, key: string, value: unknown): void {
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
}

/** RFC 7386 §2 `MergePatch(Target, Patch)`. Neither argument is mutated. */
export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  const result: JsonObject = {};
  if (isPlainObject(target)) {
    for (const key of Object.keys(target)) setOwn(result, key, target[key]);
  }
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === null) {
      delete result[key];
    } else {
      setOwn(result, key, applyMergePatch(hasOwn(result, key) ? result[key] : undefined, value));
    }
  }
  return result;
}

/** {@link applyMergePatch} restricted to what `config.patch` accepts: an object patch. */
export function mergeConfigPatch(document: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) throw new InvalidConfigPatchError();
  return applyMergePatch(document, patch);
}

function escapePointerToken(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

function collect(before: unknown, after: unknown, pointer: string, changes: ConfigChange[]): void {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const child = `${pointer}/${escapePointerToken(key)}`;
      const inBefore = hasOwn(before, key);
      const inAfter = hasOwn(after, key);
      if (inBefore && inAfter) collect(before[key], after[key], child, changes);
      else if (inBefore) changes.push({ pointer: child, before: before[key] });
      else changes.push({ pointer: child, after: after[key] });
    }
    return;
  }
  if (canonicalJson(before) !== canonicalJson(after)) changes.push({ pointer, before, after });
}

/**
 * Every changed key between two documents, by JSON Pointer, sorted by
 * pointer. Objects are walked key by key; arrays and scalars are compared
 * whole, matching how a merge patch replaces them.
 */
export function diffDocuments(before: unknown, after: unknown): ConfigChange[] {
  const changes: ConfigChange[] = [];
  collect(before, after, "", changes);
  return changes.sort((left, right) => (left.pointer < right.pointer ? -1 : left.pointer > right.pointer ? 1 : 0));
}
