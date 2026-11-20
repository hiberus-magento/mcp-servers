# @hiberus-magento/aem-sites

## 0.1.0

### Minor Changes

- f8049b2: First release of `@hiberus-magento/aem-sites`: an MCP server and CLI for the AEM as a Cloud Service Sites author. Eight read tools plus `aem_plan` / `aem_apply` for page properties, robots, sheet rows (the EDS metadata sheet), publish/unpublish through Replication and page create/copy/move/delete. One bearer token per environment; writes limited to `AEM_WRITE_ROOTS`, a page-property allowlist and no Sling POST operators. Also creates MSM Live Copies (`livecopy.create`) and locks/unlocks pages (`page.lock`, `page.unlock`); permissions stay out of scope.

### Patch Changes

- 890d774: Fix the operator CLI doing nothing when started through its npm/npx bin. npm and npx run a bin through a symlink in `node_modules/.bin`, and the entry-point check compared that symlink path with the real file, so commands such as `auth token set` and `auth status` printed nothing, stored nothing and exited 0. The check now compares real paths.
