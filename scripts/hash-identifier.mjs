#!/usr/bin/env node
// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Prints the denylist hash for an identifier, so a maintainer can add it to
// `scripts/banned-identifiers.json` without ever writing the name itself into
// a file this public repository tracks.
//
//   node scripts/hash-identifier.mjs "Some Customer Name"
import { hashIdentifier } from "./audit-synthetic-identifiers.mjs";

const raw = process.argv[2];
if (!raw) {
  console.error('usage: node scripts/hash-identifier.mjs "Some Customer Name"');
  process.exitCode = 1;
} else {
  console.log(hashIdentifier(raw));
}
