// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 3; tasks.md 3.4) that `throttledBy`
// is an exhaustive literal discriminant: a `switch` missing a case for one
// of the two throttle kinds fails to compile via the standard
// `assertNever(x: never)` pattern, because the un-narrowed remainder is not
// assignable to `never`. Run under `vitest --typecheck` (never executed).
import { test } from "vitest";
import type { AdminRateLimitError, ContentSourceThrottledError } from "./errors.js";

function assertNever(x: never): never {
  throw new Error(`Unhandled throttle kind: ${JSON.stringify(x)}`);
}

test("an exhaustive switch over throttledBy compiles", () => {
  function describeThrottle(error: AdminRateLimitError | ContentSourceThrottledError): string {
    switch (error.throttledBy) {
      case "admin-api":
        return "Admin API rate limit";
      case "content-source":
        return "Content source throttle";
      default:
        return assertNever(error);
    }
  }
  void describeThrottle;
});

test("a switch missing the content-source case fails to compile", () => {
  function describeThrottleIncomplete(error: AdminRateLimitError | ContentSourceThrottledError): string {
    switch (error.throttledBy) {
      case "admin-api":
        return "Admin API rate limit";
      default:
        // @ts-expect-error — `error` here is still narrowed to
        // ContentSourceThrottledError (the "content-source" case was never
        // handled), so it is not assignable to `never`.
        return assertNever(error);
    }
  }
  void describeThrottleIncomplete;
});
