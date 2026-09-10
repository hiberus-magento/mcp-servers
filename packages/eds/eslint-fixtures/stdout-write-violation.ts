// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Deliberately-violating fixture for `eslint-fixtures.test.ts`. Never
// imported by any real code — it exists only to prove the repo-wide
// `no-restricted-properties` ban on direct `process.stdout` access still
// fires for an ordinary source file, so the `packages/*/src/cli.ts`
// exemption (eslint.config.js) is scoped to exactly that one entrypoint and
// does not leak to the rest of the package.
export function writeDirectlyToStdout(message: string): void {
  process.stdout.write(message);
}
