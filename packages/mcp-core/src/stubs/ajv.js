// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Packaging-gate alias stub (design.md, Decision 1, rung (b)).
//
// `@modelcontextprotocol/sdk`'s stdio server statically imports `ajv` at
// `server/index.js:3` and constructs it (indirectly, via
// `AjvJsonSchemaValidator`) at `server/index.js:51` whenever no explicit
// `jsonSchemaValidator` option is supplied. That static import means esbuild
// cannot tree-shake `ajv` out of a stdio-only bundle no matter how deep the
// import path is — the ONLY way to keep it out of the artifact is to alias
// the module itself at bundle time.
//
// This is safe ONLY because every server built on this package's bootstrap
// always passes an explicit `jsonSchemaValidator`, so the real
// `AjvJsonSchemaValidator` constructor — and therefore this stub — never
// actually runs. If that invariant is ever broken (a future call site
// forgets to pass `jsonSchemaValidator`), this throws immediately and
// loudly at startup instead of silently miscompiling or hanging.
export class StubModuleInstantiatedError extends Error {
  constructor(moduleName) {
    super(
      `"${moduleName}" was instantiated at runtime, but this build aliases it to a ` +
        "non-functional packaging-gate stub. This means an explicit jsonSchemaValidator " +
        "was not supplied to the MCP server constructor. See design.md Decision 1, rung (b).",
    );
    this.name = "StubModuleInstantiatedError";
  }
}

export default class Ajv {
  constructor() {
    throw new StubModuleInstantiatedError("ajv");
  }
}
