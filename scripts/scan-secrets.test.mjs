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

describe("colorized diff input", () => {
  // `git` colorizes its output even into a pipe when a developer sets
  // `color.ui = always`, which is common. The parser keys on a line starting
  // with "+", and a colorized added line starts with an ANSI escape instead,
  // so every line was skipped and the scanner passed everything. A security
  // gate that silently depends on the reader's git config is not a gate.
  const ESC = String.fromCharCode(27);
  const coloredDiff = [
    `${ESC}[1mdiff --git a/leak.ts b/leak.ts${ESC}[m`,
    `${ESC}[1mnew file mode 100644${ESC}[m`,
    `${ESC}[1m--- /dev/null${ESC}[m`,
    `${ESC}[1m+++ b/leak.ts${ESC}[m`,
    `${ESC}[36m@@ -0,0 +1 @@${ESC}[m`,
    `${ESC}[32m+${ESC}[m${ESC}[32mconst k = "AKIA0000000000000000";${ESC}[m`,
  ].join("\n");

  it("flags a credential in a colorized diff", () => {
    const violations = scanDiff(coloredDiff);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("aws-access-key-id");
  });

  it("attributes the violation to the real file, not to an escape sequence", () => {
    expect(scanDiff(coloredDiff)[0]?.file).toBe("leak.ts");
  });
});
