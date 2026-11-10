---
"@hiberus-magento/magento-rest": minor
---

First release of `@hiberus-magento/magento-rest`: an MCP server (`hiberus-magento-rest-mcp`) and operator CLI (`hiberus-magento-rest`) for the Magento 2 / Adobe Commerce REST API. Read tools are registered by default; write tools only when `MAGENTO_REST_ALLOW_WRITES=true`. Every result is projected through a field allowlist, every list is bounded, and TLS verification cannot be disabled.
