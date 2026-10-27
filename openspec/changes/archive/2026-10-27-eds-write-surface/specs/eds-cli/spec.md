# Delta for eds-cli

## MODIFIED Requirements

### Requirement: CLI-Only Operations Excluded from MCP

`key create`, `key delete` and `auth mint` MUST exist only as CLI commands; none MAY have a
corresponding MCP tool or `eds_plan` operation kind. `key create` and `auth mint` return the created
key value exactly once, and it must not enter a model's context. `key delete` is an org-level
operation that does not fit `eds_plan`'s site-scoped input or protected-site matching.
(Previously: thirteen operations were listed — `site apply`, `site delete`, `site source set`,
`key create`, `key delete`, `auth mint`, `code show`, `code sync`, `code delete`,
`version restore`, `cache purge`, `robots show`, `sitemap rebuild`. All but `key create`,
`key delete` and `auth mint` are now reachable through `eds_plan`/`eds_apply` or a read tool.
`site apply` and `site source set` are not ported as such: they are covered generically by
`site.create` and `config.patch`, and project-specific site generation stays out of the package.)

#### Scenario: CLI-only command has no MCP tool

- GIVEN `key create`, `key delete` and `auth mint`
- WHEN the MCP server's `tools/list` response and the `eds_plan` operation kinds are inspected
- THEN none corresponds to any tool or operation kind
