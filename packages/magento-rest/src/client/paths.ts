// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The ONLY way this package builds a REST path. Every interpolated value is
// encoded as exactly one path segment, so a caller-supplied SKU can never add
// a segment (`/`), start a query (`?`), start a fragment (`#`) or traverse to
// another endpoint (`..`). `encodeURIComponent` alone is not enough: it
// leaves `.` untouched, and a bare `..` segment is resolved by URL parsing.
function encodeSegment(value: string | number): string {
  const text = String(value);
  if (text === "") {
    throw new Error("restPath: an empty path segment is not allowed");
  }
  // Only an all-dots segment is special to URL resolution; an inner dot
  // (`v1.2`) is an ordinary character and stays readable.
  if (/^\.+$/.test(text)) {
    return text.replaceAll(".", "%2E");
  }
  return encodeURIComponent(text);
}

/** Tagged template: `restPath\`/products/${sku}\`` -> `/products/<encoded sku>`. */
export function restPath(strings: TemplateStringsArray, ...values: ReadonlyArray<string | number>): string {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i += 1) {
    out += encodeSegment(values[i] as string | number) + (strings[i + 1] ?? "");
  }
  return out;
}
