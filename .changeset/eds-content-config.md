---
"@hiberus-magento/eds": minor
---

`eds_plan` can now set a site's index definition (`query.yaml`) or sitemap definition (`sitemap.yaml`) in the configuration service, with the new kind `content-config.set`. The plan shows the current YAML (or `(none)`) next to the new one and warns that the site needs a reindex. `eds_apply` creates the document with a `text/yaml` `PUT` when the site has none and replaces it with `POST` otherwise, and refuses a plan whose document changed in the meantime. The new read tool `eds_get_content_config` reads either file and reports `exists: false` for a site without it.
