---
"@hiberus-magento/magento-rest": patch
---

Harden the database tools and the REST transport before the first release. The SQL guard refuses `??` identifier placeholders, matches credential tables under a Magento table prefix (and adds the 2FA, session and ACL tables), and refuses queries that reference credential-named columns; result redaction also uses the original column name, so an alias no longer reveals a credential. Each REST attempt is aborted after a timeout instead of hanging when Magento never answers.
