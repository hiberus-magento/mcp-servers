---
"@hiberus-magento/aco": patch
"@hiberus-magento/aem-sites": patch
"@hiberus-magento/eds": patch
"@hiberus-magento/magento-cloud": patch
"@hiberus-magento/magento-graphql": patch
"@hiberus-magento/magento-rest": patch
---

Fix the operator CLI doing nothing when started through its npm/npx bin. npm and npx run a bin through a symlink in `node_modules/.bin`, and the entry-point check compared that symlink path with the real file, so commands such as `auth token set` and `auth status` printed nothing, stored nothing and exited 0. The check now compares real paths.
