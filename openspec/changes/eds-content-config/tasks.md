## 1. Client

- [x] 1.1 RED → GREEN: `content-config.ts` (path, GET with 404 → `null`, PUT/POST as `text/yaml`), `textType` on `SendOptions` and `PlannedRequest`, `writeRequests.contentConfigSet` equal to its typed twin

## 2. Plan and apply

- [x] 2.1 RED → GREEN: `content-config.set` in the schema (strict, `file` enum, non-empty content), plan (diff, `(none)`, reindex warning, PUT/POST, no-changes) and stale check
- [x] 2.2 RED → GREEN: `eds_get_content_config` read tool; fifteen tools

## 3. Docs and verification

- [x] 3.1 README, `servers.json`, `eds-client` and `eds-mcp` specs
- [x] 3.2 The 8 verification commands pass
- [ ] 3.3 Live: plan and apply `content-config.set` for both files on a real site, read them back with `eds_get_content_config`, and record the result
