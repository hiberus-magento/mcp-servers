// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Field-by-field projection from a named allowlist — the repository-wide rule
// that an undeclared field cannot reach a caller. Magento responses carry
// whatever the instance's modules add (extension attributes, payment blocks,
// address books), so passing the parsed body through, or spreading it, would
// serialize every one of them to the model.
//
// A shape is a list. A plain string keeps that key ONLY when its value is a
// primitive (or an array of primitives); an object under a plain string is
// dropped, because letting one through whole would reopen exactly the hole
// the allowlist closes. To keep fields of a nested object, list the key as
// `[key, nestedShape]`. Arrays are mapped element by element.
export type Shape = readonly (string | readonly [string, Shape])[];

type Primitive = string | number | boolean | null;

function isPrimitive(value: unknown): value is Primitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isPrimitiveArray(value: unknown): value is readonly Primitive[] {
  return Array.isArray(value) && value.every(isPrimitive);
}

export function project(value: unknown, shape: Shape): unknown {
  if (Array.isArray(value)) {
    return value.map((element) => project(element, shape));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const entry of shape) {
    const key = typeof entry === "string" ? entry : entry[0];
    // Own properties only: a key must never resolve through the prototype chain.
    if (!Object.hasOwn(source, key)) {
      continue;
    }
    const field = source[key];
    if (typeof entry === "string") {
      if (isPrimitive(field) || isPrimitiveArray(field)) {
        out[key] = field;
      }
    } else if (field !== null && typeof field === "object") {
      out[key] = project(field, entry[1]);
    }
  }
  return out;
}
