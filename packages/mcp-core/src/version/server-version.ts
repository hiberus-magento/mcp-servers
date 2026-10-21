// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// The version a server announces in `initialize`'s `serverInfo`.
//
// Every server used to hardcode `version: "0.0.0"` in its `McpServer`
// constructor while its package shipped at 0.1.0, so the one question an
// operator asks a server directly — "which version am I running" — got a
// confident wrong answer, and a client keying behavior off `serverInfo`
// read a constant.
//
// The version is substituted at BUILD time: each package's `tsup.config.ts`
// reads its own `package.json` and passes the value through esbuild's
// `define` as `__MCP_SERVER_VERSION__`. `mcp-core` is bundled into every
// server, so the substitution reaches this file too, and the identifier
// below is a string literal in the shipped bundle — no filesystem access,
// no path assumption, nothing to resolve at startup.
//
// REJECTED, and why: reading the shipped `package.json` at runtime via
// `new URL("../package.json", import.meta.url)`. It would work (every
// entrypoint sits exactly one directory under its package root, in `src/`
// and in `dist/` alike, and npm always ships `package.json`), but it buys a
// synchronous read and a JSON parse on a startup path that is CPU-budgeted,
// and it makes the shipped binary depend on its own file layout surviving
// whatever a consumer does with it. A build-time constant depends on
// nothing.
//
// REJECTED, and why: `import pkg from "../package.json" with { type: "json" }`,
// which esbuild would inline with no config at all. Every package's
// `tsconfig.json` sets `rootDir: "src"`, so a sibling import of the
// package root's `package.json` fails `tsc --noEmit` outright; widening
// `rootDir` to make one constant resolvable is a worse trade than four
// two-line build configs.
//
// There is no fallback. A missing define means a server would announce a
// made-up version, which is the defect this module exists to end, so it
// throws at construction instead. Nothing imports a server entrypoint under
// vitest — they connect their transport at module top level and are only
// ever driven as built subprocesses — so the throw cannot strand a test.

/**
 * Substituted by esbuild `define` at build time (see this file's header).
 * Declared, never defined: outside a bundle the identifier simply does not
 * exist, which `serverVersion()` detects through `typeof`.
 */
declare const __MCP_SERVER_VERSION__: string | undefined;

/** The esbuild `define` key every server's `tsup.config.ts` must set. */
export const SERVER_VERSION_DEFINE = "__MCP_SERVER_VERSION__";

/**
 * Validates an injected version, separated from {@link serverVersion} so
 * both outcomes are reachable in a unit test — the injected path cannot be
 * exercised through `serverVersion()` itself, which by construction only
 * ever sees the define inside a real bundle.
 */
export function resolveServerVersion(injected: unknown): string {
  if (typeof injected !== "string" || injected.length === 0) {
    throw new Error(
      `${SERVER_VERSION_DEFINE} was not substituted at build time (got ${JSON.stringify(injected)}). ` +
        `Set it from this package's own package.json in its tsup.config.ts "define".`,
    );
  }
  return injected;
}

/**
 * The version to pass to `new McpServer({ name, version })`. Returns the
 * version of the package that built this bundle; throws if the build never
 * injected one, rather than announcing something untrue.
 */
export function serverVersion(): string {
  return resolveServerVersion(typeof __MCP_SERVER_VERSION__ === "undefined" ? undefined : __MCP_SERVER_VERSION__);
}
