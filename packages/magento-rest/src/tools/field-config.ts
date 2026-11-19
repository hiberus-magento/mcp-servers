// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The operator's way to WIDEN or NARROW what a resource exposes, without
// editing code. Read from the file `MAGENTO_REST_FIELDS_FILE` points at, once,
// at startup.
//
// Widening what an agent can read is exactly the kind of switch this
// repository refuses to make easy to flip by accident: there is no variable
// that turns secret redaction off, because that is the one a compromised
// environment would set. So this file is built to be hard to misuse:
//
//   - the only keys a resource may carry are `add` and `remove`; a `replace`,
//     `only` or `*` is an error, so no file can swap the shipped list for
//     "everything". `remove` can only take away what is really on the shipped
//     list (a typo is an error, not a silent no-op), never an identifier the
//     tools chain on (`id`, `sku`, ...), and never everything: narrowing
//     cannot leak, but it can make a tool useless without saying so;
//   - every path is validated against a closed shape, never interpolated;
//   - there is a FLOOR no file can lower: a path with a credential or payment
//     segment is refused outright. Personal data (an email, an address) is
//     deliberately NOT in the floor — whether a project may show it to a model
//     is that organisation's decision, made in a reviewed file, not ours.
//
// An invalid file is an error, not a warning: the caller (`mcp.ts`) stops the
// server rather than starting with fewer fields than the operator asked for,
// or with a half-applied configuration.
import type { Shape } from "./project.js";
import { RESOURCE_NAMES, type ResourceName, type ShapeSet } from "./shapes.js";

export interface FieldChange {
  readonly add?: readonly string[];
  readonly remove?: readonly string[];
}

export type FieldConfig = Readonly<Partial<Record<ResourceName, FieldChange>>>;

export class FieldConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldConfigError";
  }
}

const MAX_ADDITIONS_PER_RESOURCE = 100;
const MAX_PATH_DEPTH = 4;
const SEGMENT_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

// The floor: credentials and payment. Matched per path SEGMENT, case
// insensitively, so `extension_attributes.payment_additional_info` and
// `PASSWORD_HASH` are both caught. It errs toward refusing (`card` also
// catches `discard`): a false refusal costs an operator a code change, a false
// acceptance costs a leaked credential.
// Identifiers the tools chain on: a result without them cannot be fed to the next call.
const PROTECTED_FROM_REMOVAL: readonly string[] = ["id", "sku", "entity_id", "increment_id"];

const SENSITIVE_SEGMENT_PATTERN = /pass(?:word|wd)|hash|token|secret|api_?key|^cc_|card|cvv|cvc|iban|payment|credential|private_?key/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateShape(resource: string, path: string): void {
  const segments = path.split(".");
  if (segments.length > MAX_PATH_DEPTH) {
    throw new FieldConfigError(`field configuration: "${resource}" path ${JSON.stringify(path)} is deeper than ${MAX_PATH_DEPTH} levels`);
  }
  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment)) {
      throw new FieldConfigError(
        `field configuration: "${resource}" path ${JSON.stringify(path)} is malformed — use letters, digits and underscores, joined by dots (no wildcards, spaces or empty segments)`,
      );
    }
  }
}

function validateAddition(resource: string, path: string): void {
  validateShape(resource, path);
  const sensitive = path.split(".").find((segment) => SENSITIVE_SEGMENT_PATTERN.test(segment));
  if (sensitive !== undefined) {
    throw new FieldConfigError(`field configuration: "${resource}" path ${JSON.stringify(path)} cannot be added by configuration — "${sensitive}" names a credential or payment field`);
  }
}

function validateRemoval(resource: string, path: string): void {
  validateShape(resource, path);
  if (PROTECTED_FROM_REMOVAL.includes(path)) {
    throw new FieldConfigError(`field configuration: "${resource}" cannot remove ${JSON.stringify(path)} — it is an identifier the tools need to chain calls`);
  }
}

/** Equal, or one encloses the other (`a` encloses `a.b`), compared on whole segments. */
function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

/** Reads one `add` or `remove` list: an array of strings, bounded, each path validated, duplicates dropped. */
function readPaths(resource: string, key: "add" | "remove", value: unknown, validate: (resource: string, path: string) => void): readonly string[] {
  if (!Array.isArray(value)) {
    throw new FieldConfigError(`field configuration: "${resource}".${key} must be an array of strings`);
  }
  if (value.length > MAX_ADDITIONS_PER_RESOURCE) {
    throw new FieldConfigError(`field configuration: "${resource}" ${key === "add" ? "adds" : "removes"} ${value.length} fields; the limit is ${MAX_ADDITIONS_PER_RESOURCE}`);
  }
  const paths: string[] = [];
  for (const path of value) {
    if (typeof path !== "string") {
      throw new FieldConfigError(`field configuration: "${resource}".${key} must contain only strings`);
    }
    validate(resource, path);
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
}

export function parseFieldConfig(text: string): FieldConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new FieldConfigError(`field configuration is not valid JSON: ${cause instanceof Error ? cause.message : "parse failure"}`);
  }
  if (!isPlainObject(parsed)) {
    throw new FieldConfigError("field configuration must be a JSON object keyed by resource name");
  }

  const known: readonly string[] = RESOURCE_NAMES;
  const result: Partial<Record<ResourceName, FieldChange>> = {};

  for (const [resource, value] of Object.entries(parsed)) {
    if (!known.includes(resource)) {
      throw new FieldConfigError(`field configuration: unknown resource ${JSON.stringify(resource)}; known resources: ${RESOURCE_NAMES.join(", ")}`);
    }
    if (!isPlainObject(value)) {
      throw new FieldConfigError(`field configuration: "${resource}" must be an object of the form { "add": [...] } or { "remove": [...] }`);
    }
    for (const key of Object.keys(value)) {
      if (key !== "add" && key !== "remove") {
        throw new FieldConfigError(
          `field configuration: "${resource}" has unsupported key ${JSON.stringify(key)}; only "add" and "remove" are allowed, so a file can widen or narrow a list but never replace it`,
        );
      }
    }
    if (value["add"] === undefined && value["remove"] === undefined) {
      throw new FieldConfigError(`field configuration: "${resource}" must have an "add" or a "remove" array`);
    }
    const add = value["add"] === undefined ? undefined : readPaths(resource, "add", value["add"], validateAddition);
    const remove = value["remove"] === undefined ? undefined : readPaths(resource, "remove", value["remove"], validateRemoval);
    for (const added of add ?? []) {
      const clash = (remove ?? []).find((removed) => overlaps(added, removed));
      if (clash !== undefined) {
        throw new FieldConfigError(`field configuration: "${resource}" both adds ${JSON.stringify(added)} and removes ${JSON.stringify(clash)}; say one or the other`);
      }
    }
    result[resource as ResourceName] = { ...(add !== undefined ? { add } : {}), ...(remove !== undefined ? { remove } : {}) };
  }
  return result;
}

type Entry = string | readonly [string, Shape];

/** A copy of `shape` that also allows the path `segments`; the input is never mutated. */
function addPath(shape: Shape, segments: readonly string[]): Shape {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return shape;
  }
  if (rest.length === 0) {
    return shape.includes(head) ? shape : [...shape, head];
  }
  const index = shape.findIndex((entry) => typeof entry !== "string" && entry[0] === head);
  if (index === -1) {
    return [...shape, [head, addPath([], rest)] as const];
  }
  const existing = shape[index] as readonly [string, Shape];
  const next: Entry[] = [...shape];
  next[index] = [head, addPath(existing[1], rest)] as const;
  return next;
}

/** A copy of `shape` without the path `segments`, or `undefined` when that path is not on it. */
function removePath(shape: Shape, segments: readonly string[]): Shape | undefined {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return undefined;
  }
  const index = shape.findIndex((entry) => (typeof entry === "string" ? entry : entry[0]) === head);
  if (index === -1) {
    return undefined;
  }
  const entry = shape[index] as Entry;
  if (rest.length === 0) {
    return shape.filter((_, i) => i !== index);
  }
  if (typeof entry === "string") {
    return undefined;
  }
  const nested = removePath(entry[1], rest);
  if (nested === undefined) {
    return undefined;
  }
  if (nested.length === 0) {
    return shape.filter((_, i) => i !== index);
  }
  const next: Entry[] = [...shape];
  next[index] = [head, nested] as const;
  return next;
}

/**
 * The shipped shapes, minus what the configuration removes, plus what it adds. Never mutates `base`.
 * A removal of something that is not on the shipped list, or that would leave a resource empty, is an error.
 */
export function applyFieldConfig(base: ShapeSet, config: FieldConfig): ShapeSet {
  const changed: Record<ResourceName, Shape> = { ...base };
  for (const resource of RESOURCE_NAMES) {
    const change = config[resource];
    if (change === undefined) {
      continue;
    }
    let shape = base[resource];
    for (const path of change.remove ?? []) {
      const next = removePath(shape, path.split("."));
      if (next === undefined) {
        throw new FieldConfigError(`field configuration: "${resource}" cannot remove ${JSON.stringify(path)} — it is not on the shipped list for that resource`);
      }
      shape = next;
    }
    if (shape.length === 0) {
      throw new FieldConfigError(`field configuration: removals would leave "${resource}" with no fields`);
    }
    changed[resource] = (change.add ?? []).reduce<Shape>((current, path) => addPath(current, path.split(".")), shape);
  }
  return changed;
}
