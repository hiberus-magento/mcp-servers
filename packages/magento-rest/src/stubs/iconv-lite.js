// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Packaging-gate alias stub for `iconv-lite` (the same rung as `mcp-core`'s `ajv` stubs).
//
// `mysql2` calls iconv-lite ONLY to convert a result whose charset Node cannot decode natively. With the
// connection charset this package always requests (`utf8mb4`), every value is decoded by `Buffer`, so the
// real module — 539 KB of Chinese, Japanese and Korean code tables that push the bundle over the 2 MB limit —
// is never reached. If a server answers in another charset anyway, this fails loudly and says why, instead
// of returning garbled text.
export class UnsupportedCharsetError extends Error {
  constructor(encoding) {
    super(
      `The database returned text in the "${String(encoding)}" charset, which this build cannot decode ` +
        "(only UTF-8 and Latin-1 are bundled). Convert the column to utf8mb4 or select it with CONVERT(... USING utf8mb4).",
    );
    this.name = "UnsupportedCharsetError";
  }
}

export function getDecoder(encoding) {
  throw new UnsupportedCharsetError(encoding);
}

export function getEncoder(encoding) {
  throw new UnsupportedCharsetError(encoding);
}

export default { getDecoder, getEncoder };
