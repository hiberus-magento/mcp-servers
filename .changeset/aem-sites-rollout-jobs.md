---
"@hiberus-magento/aem-sites": minor
---

`livecopy.rollout` no longer waits for the async job by default: `aem_apply` answers `accepted` with a `jobId` as soon as the author accepts the rollout, and the new read-only `aem_get_job_status` reports whether the job has reached its targets (`cq:lastRolledout`). `wait: true` keeps the old behaviour with a 15-minute limit. In a batch, an accepted rollout no longer stops the batch, so several rollouts go under one plan and one confirmation. A rollout can now target a new page that a Live Copy does not have yet, resolved through the Live Copy root above it.
