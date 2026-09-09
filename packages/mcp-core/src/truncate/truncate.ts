// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Output truncation with an explicit marker (design.md, Decision 6). Applied
// by the `defineTool` wrapper as a backstop, so no tool can return unbounded
// output even if its author forgot pagination. Cuts at a UTF-8 character
// boundary — never mid-sequence — and appends a marker naming exactly how
// many of the original bytes were kept and how many existed in total. The
// marker is appended after the byte cap rather than counted against it: it
// is short, fixed-shape metadata, and shrinking the cap to make room for it
// would make the reported "N of M" counts depend on the marker's own length.
const TRUNCATION_SUFFIX = " bytes — request page 2]";

function cutAtUtf8Boundary(buffer: Buffer, maxBytes: number): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = maxBytes; end >= 0; end -= 1) {
    try {
      return decoder.decode(buffer.subarray(0, end));
    } catch {
      // Landed mid-sequence — back up one byte and try again. UTF-8
      // sequences are at most 4 bytes, so this loop is bounded.
    }
  }
  return "";
}

export function truncate(input: string, maxBytes: number): string {
  const buffer = Buffer.from(input, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return input;
  }

  const kept = cutAtUtf8Boundary(buffer, maxBytes);
  const keptBytes = Buffer.byteLength(kept, "utf8");
  return `${kept}[truncated: ${keptBytes} of ${buffer.byteLength}${TRUNCATION_SUFFIX}`;
}
