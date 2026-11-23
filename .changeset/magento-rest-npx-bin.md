---
"@hiberus-magento/magento-rest": patch
---

Adds a `magento-rest` bin that starts the MCP server, so `npx @hiberus-magento/magento-rest` (and an MCP host or the MCP registry's npx launch, which run the bin named after the unscoped package) finds it. The `hiberus-magento-rest` CLI and `hiberus-magento-rest-mcp` bins are unchanged.
