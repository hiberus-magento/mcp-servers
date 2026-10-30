---
"@hiberus-magento/aem-sites": minor
---

First release of `@hiberus-magento/aem-sites`: an MCP server and CLI for the AEM as a Cloud Service Sites author. Eight read tools plus `aem_plan` / `aem_apply` for page properties, robots, sheet rows (the EDS metadata sheet), publish/unpublish through Replication and page create/copy/move/delete. One bearer token per environment; writes limited to `AEM_WRITE_ROOTS`, a page-property allowlist and no Sling POST operators. Also creates MSM Live Copies (`livecopy.create`) and locks/unlocks pages (`page.lock`, `page.unlock`); permissions stay out of scope.
