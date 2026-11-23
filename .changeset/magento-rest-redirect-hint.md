---
"@hiberus-magento/magento-rest": patch
---

A redirect from Magento (a store with "Add Store Code to Urls" answers `/rest/...` with a 301 to `/<store code>/rest/...`) is still not followed, but it is now reported as `invalid_argument` on `MAGENTO_REST_BASE_URL`, and the message names the base URL to use instead when the redirect target shows it. The onboarding guide also covers a TLS-inspecting corporate proxy (`--use-system-ca`).
