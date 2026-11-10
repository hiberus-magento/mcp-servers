// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// Packaging-gate alias stub for `aws-ssl-profiles` (181 KB of Amazon RDS certificates).
//
// `mysql2` reads it only to build its deprecated `ssl: "Amazon RDS"` profile. This package never passes a
// profile name: TLS is requested with an explicit `ssl` object, so these certificates are never used. The
// list is empty rather than throwing because `mysql2` reads it when it loads; a connection that did rely on
// the profile would fail certificate verification, which is the safe direction.
export const ca = [];

export default { ca };
