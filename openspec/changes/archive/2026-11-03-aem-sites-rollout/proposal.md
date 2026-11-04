# Proposal: aem-sites-rollout — push a source page to its Live Copies

## Intent

A fix made in a language master reaches the stores only through an MSM rollout. Observed on
2026-10-30 on a non-production author: the cart block of every global language master points its
"start shopping" link at the language master root page instead of its `index`, so every store
serves a raw `/content/…` link; fixing nine source pages is useless until they are rolled out to the
vertical language masters and from there to the stores. The MCP could create Live Copies but not
roll out, and editing the copies directly would cancel their inheritance.

## Scope

### In Scope

- `livecopy.rollout { path, targets, deep? }`: the Sites console's async rollout request
  (`POST /bin/asynccommand`, `cmd=rollout`, `operation=asyncRollout`, `type=page|deep`,
  `msm:targetPath` as a JSON list, `paras=[]`, `reportSchedule=now`), read from the console's own
  clientlibs (`/libs/wcm/msm/content/touch-ui/authoring/rollout`, References rail).
  - Source: any readable page. Targets: 1–100 existing pages inside the write roots, none inside or
    above the source.
  - The plan lists the targets and warns that their inherited content is overwritten.
  - Apply waits until each target's `cq:lastRolledout` differs from its plan-time value (poll every
    3 s, up to 5 min), so a batch can chain levels (global → vertical → store).

### Out of Scope

- Rolling out to every Live Copy of a source without naming them (`msm:async` with no targets).
- Selected-component rollouts (`type=selected`), scheduled rollouts, synchronisation from the Live
  Copy side, suspend and detach.
- Checking at plan time that each target really is a Live Copy of the source (not exposed by the
  current reads; a target that is not would never get a new `cq:lastRolledout` and fail on timeout).

## Risks

| Risk | Mitigation |
|---|---|
| A rollout overwrites content an author edited without cancelling inheritance | Warning in every plan; targets listed explicitly |
| The async job never runs | Apply fails after 5 min naming the targets not reached; a batch stops there |
| A wrong target outside the project | Targets must be inside `AEM_WRITE_ROOTS` |
