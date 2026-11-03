---
"@hiberus-magento/aem-sites": minor
---

`livecopy.rollout` no longer waits for the async job by default: `aem_apply` answers `accepted` with a `jobId` as soon as the author accepts the rollout, and the new read-only `aem_get_job_status` reports whether the job has reached its targets (`cq:lastRolledout`). `wait: true` keeps the old behaviour with a 15-minute limit. In a batch, an accepted rollout no longer stops the batch, so several rollouts go under one plan and one confirmation. A rollout to a page that does not exist names the deep rollout of its parent that creates it, and deep rollouts warn that they bring down every pending change of the subtree.
