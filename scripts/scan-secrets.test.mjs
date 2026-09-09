// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first test for tasks.md 12.6: a commit introducing a credential-shaped
// string is caught by the secret scanner, which reports the offending file
// and line (release-pipeline spec, "Secret Scanning").
import { describe, expect, it } from "vitest";
import { scanDiff } from "./scan-secrets.mjs";

const CLEAN_DIFF = `diff --git a/example.ts b/example.ts
index 1111111..2222222 100644
--- a/example.ts
+++ b/example.ts
@@ -1,0 +2 @@
+export const greeting = "hello";
`;

const SECRET_DIFF = `diff --git a/example.ts b/example.ts
index 1111111..2222222 100644
--- a/example.ts
+++ b/example.ts
@@ -1,0 +2 @@
+const apiKey = "sk_live_ABCDEFGHIJKLMNOPQRST1234";
`;

describe("scanDiff", () => {
  it("reports no violations for a diff with no credential-shaped strings", () => {
    const violations = scanDiff(CLEAN_DIFF);
    expect(violations).toEqual([]);
  });

  it("catches a committed token and reports the offending file and line", () => {
    const violations = scanDiff(SECRET_DIFF);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("example.ts");
    expect(violations[0].line).toBe(2);
  });
});
