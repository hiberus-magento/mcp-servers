// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
import { describe, expect, it } from "vitest";
import Ajv, { StubModuleInstantiatedError } from "./ajv.js";
import addFormats from "./ajv-formats.js";

describe("packaging-gate alias stubs", () => {
  it("throws a named error when the aliased ajv constructor runs", () => {
    expect(() => new Ajv()).toThrow(StubModuleInstantiatedError);
    expect(() => new Ajv()).toThrow(/non-functional packaging-gate stub/);
  });

  it("names the error 'StubModuleInstantiatedError' so a regression is unambiguous", () => {
    try {
      new Ajv();
      throw new Error("expected constructor to throw");
    } catch (error) {
      expect(error.name).toBe("StubModuleInstantiatedError");
    }
  });

  it("throws when the aliased ajv-formats function runs", () => {
    expect(() => addFormats()).toThrow(StubModuleInstantiatedError);
    expect(() => addFormats()).toThrow(/"ajv-formats" was instantiated/);
  });
});
