---
"@hiberus-magento/eds": minor
---

Every change to an Edge Delivery Services site now goes through one reviewed path. `eds_plan` changes nothing and returns:

- the exact requests, plus every changed configuration key with its value before and after;
- the warnings;
- a confirmation message assembled by the server;
- a one-time token.

The user confirms, and `eds_apply`, which takes only that token, sends exactly the planned requests. Tokens expire after ten minutes and work once. A plan whose configuration or `robots.txt` changed in the meantime is refused without writing. `EDS_PROTECTED_SITES` lists sites for which the user must also type the site name. `eds_apply` is marked `anthropic/requiresUserInteraction`, so Claude Code asks before every call; `docs/eds-onboarding.md` gives the setting for VS Code Copilot and opencode.

`eds_plan` covers 22 operation kinds, including the ones 0.1 left out of the MCP surface:

- site configuration (RFC 7386 merge patch), site create and delete, and configuration version restore;
- `robots.txt`;
- preview;
- cache purge and sitemap rebuild;
- code sync and delete, with the repository read from the site's own configuration;
- stopping a job.

There are six new read tools: `eds_list_sites`, `eds_get_config_versions`, `eds_get_robots`, `eds_get_code_status`, `eds_list_jobs` and `eds_list_api_keys`, the last one returning metadata only. Creating and deleting API keys stays off the MCP surface.

**Breaking:** `eds_set_live_state`, `eds_reindex` and `eds_manage_snapshot` are removed. Their operations are `live.publish`/`live.unpublish`, `index.update`/`index.full-site` and `snapshot.*` in `eds_plan`. The package README has a migration table.

**Fix:** 0.1's `eds_set_live_state` with `unpublished` on several paths sent the bulk job without `delete: true`; `live.unpublish` sends it.

Alpha. Only `snapshot.add` and `snapshot.delete` have run against a live site. Every other new operation is built from the Admin API contract and is marked unverified in its tool description.
