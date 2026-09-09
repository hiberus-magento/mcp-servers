// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Type-level proof (design.md, Decision 3; tasks.md 3.6) that
// `ContentSourceThrottledError` is rejected by the retry policy's input
// type. Retrying a content-source throttle is the wrong remedy (client-side
// pacing cannot fix upstream throttling) — this makes it a compile error,
// not a judgement call. Run under `vitest --typecheck` (never executed).
import { test } from "vitest";
import { ContentSourceThrottledError } from "./errors.js";
import type { RetryOutcome } from "./retry.js";

test("ContentSourceThrottledError is not assignable to RetryOutcome.error", () => {
  const outcome: RetryOutcome = {
    // @ts-expect-error — ContentSourceThrottledError is deliberately excluded
    // from the retryable union (AdminRateLimitError | TransientNetworkError | GatewayError).
    error: new ContentSourceThrottledError({ status: 503, xError: "(429)" }),
    idempotent: true,
  };
  void outcome;
});
