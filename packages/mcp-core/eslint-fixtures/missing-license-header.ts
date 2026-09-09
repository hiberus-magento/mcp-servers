// Deliberately-violating fixture for `eslint-fixtures.test.ts`. This file
// intentionally omits the required Apache-2.0 copyright header comment so
// the `license-header/require-header` rule (eslint.config.js) can be proven
// to fire. Do not add the header here — that would defeat the fixture's
// purpose.
export function noHeaderHere(): string {
  return "no header here";
}
