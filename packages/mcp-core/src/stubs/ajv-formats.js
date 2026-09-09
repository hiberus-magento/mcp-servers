// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Packaging-gate alias stub — see `./ajv.js` for the full rationale.
// `ajv-formats` is only ever invoked from inside the SDK's
// `createDefaultAjvInstance()`, which itself only runs from the real
// `AjvJsonSchemaValidator` constructor. That constructor never runs as long
// as callers always supply an explicit `jsonSchemaValidator`, so this stub
// throwing loudly on invocation is a startup-time regression guard, not a
// runtime code path any server actually exercises.
import { StubModuleInstantiatedError } from "./ajv.js";

export default function addFormats() {
  throw new StubModuleInstantiatedError("ajv-formats");
}
