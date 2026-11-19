---
"@hiberus-magento/magento-cloud": minor
---

`magentocloud_query_database` takes optional top-level `relationship` and `app` fields, for both `{ kind: "size" }` and `{ kind: "select" }`, forwarded to the upstream CLI as `--relationship` / `--app`. An environment with more than one database relationship (for example a `database` primary and a `database-slave` read replica) or more than one application made the CLI refuse to choose without a terminal, so the tool failed outright; naming the target now works, and a read replica is the recommended choice for diagnostics.

Both values must be lowercase names (letters, digits, `-`, `_`, never starting with `-`; a relationship may carry the CLI's `.<index>` suffix), at most 64 characters, and are rejected before any process is spawned otherwise. When the CLI still refuses for lack of a choice, the error names the field to set and lists the relationship names the CLI offered. Omitting both leaves the spawned command unchanged. The operator CLI's `db:sql` gains matching `--relationship` / `--app` flags.
