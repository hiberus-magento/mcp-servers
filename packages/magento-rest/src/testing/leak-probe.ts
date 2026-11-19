// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Test infrastructure for the projection guarantee. Returns a copy of a fake
// Magento response with an UNDECLARED field added to every object at every
// depth. A tool test feeds that to the fetch double and asserts the probe
// value is absent from what the tool returned — the form an agent receives.
// It is how "an undeclared field cannot reach a caller" is proven per tool,
// rather than assumed from the projection helper's own unit test.
export const LEAK_PROBE_VALUE = "do-not-leak";

export function injectLeakProbe(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(injectLeakProbe);
  }
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      copy[key] = injectLeakProbe(nested);
    }
    copy["leak_probe"] = LEAK_PROBE_VALUE;
    return copy;
  }
  return value;
}
