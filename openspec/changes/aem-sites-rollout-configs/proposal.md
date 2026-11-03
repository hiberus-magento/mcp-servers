# Proposal: aem-sites-rollout-configs — change how a Live Copy is synchronised

## Intent

A three-level MSM tree (global → vertical → store) created with the Standard rollout config only
moves when someone rolls out each level by hand: a change in a global page needs one rollout to the
vertical copies and another from each of them to the stores. AEM can roll out on its own when the
source changes (the built-in Push on modify config), but the config of a Live Copy is chosen when it
is created, and the MCP could only set it then. Recreating the copies to change it would lose their
local edits and their publication. This change adds one guarded operation that replaces the rollout
configs of an existing Live Copy.

## Scope

### In Scope

- `livecopy.set-rollout-configs { path, rolloutConfigs }`: `path` is the root of an existing Live
  Copy inside the write roots (the page that holds `jcr:content/cq:LiveSyncConfig`);
  `rolloutConfigs` (1–10) replaces the current list, in order.
  - A Sling POST to `<path>/jcr:content/cq:LiveSyncConfig` with `cq:rolloutConfigs` typed
    `String[]`, where the Sites console's Live Copy properties keep them.
  - Same allowlist as `livecopy.create`: AEM's built-in `default`, `pushonmodify`, `activate`,
    `deactivate`, plus `AEM_EXTRA_ROLLOUT_CONFIGS`.
  - A page without `cq:LiveSyncConfig` is refused (`invalid-operation`); the same list returns
    `no-changes`.
  - The plan shows the lists before and after, notes that pages below the root follow it, and
    warns when the new list includes Push on modify.
  - A `page` state check, so a config changed in the console meanwhile makes the plan stale.

### Out of Scope

- Setting configs on a page below a Live Copy root (it has no `cq:LiveSyncConfig` of its own;
  creating one is a different MSM operation).
- Inheriting the configs from the parent Live Copy, suspending, detaching.
- Whether a write made by a rollout counts as a modification for a downstream Push on modify: not
  documented by Adobe; recorded by the live validation below.

## Risks

| Risk | Mitigation |
|---|---|
| Push on modify rolls out unreviewed edits of the source to every store | Warning on every plan that adds it; the targets are named one by one |
| The console reads the configs from somewhere else than the node | Live validation: the Sites console and a rollout behave with the new list |
| A config path that is not a rollout config | Closed allowlist shared with `livecopy.create` |

## Success Criteria

- [x] `livecopy.set-rollout-configs` passes the token matrix (forged, expired, reused, stale, echo).
- [x] Builder tests for the request, the allowlist and the write roots.
- [ ] Validated on a non-production author: a store Live Copy gets Standard + Push on modify, a
      change in its source reaches it without a manual rollout, and the result of a rollout from
      the level above is recorded.
