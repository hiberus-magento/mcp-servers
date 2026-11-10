# Proposal: aem-sites-msm — Live Copies and page locks

## Intent

Asked for "a Live Copy of a page that nobody can edit", the agent had to say no: `aem-sites-package`
left MSM and permissions out of scope. The spike (`exploration.md`) showed the Sites console's own
requests work with the server's bearer token, so two of the three needs can be met without
widening what the server is allowed to touch.

## Scope

### In Scope

- `livecopy.create` — `POST /bin/wcmcommand cmd=createLiveCopy`. Source: any readable page under
  `/content/`. Destination: inside `AEM_WRITE_ROOTS`, must not exist, never inside or above its own
  source. Rollout configs: AEM's built-in four, plus exact paths in `AEM_EXTRA_ROLLOUT_CONFIGS`
  (under `/apps/msm/` or `/conf/`); default `/libs/msm/wcm/rolloutconfigs/default`.
- `page.lock` / `page.unlock` — `cmd=lockPage` / `cmd=unlockPage`. The lock owner is the token's
  user, read from `/libs/granite/security/currentuser.json`. Locking a page another user locked,
  or unlocking someone else's lock, is a `locked-by-other` rejection.
- `aem_get_page` reports `liveCopy` (master, rollout configs, deep) for a Live Copy root — page
  reads move from `jcr:content.json` to `jcr:content.1.json` to see `cq:LiveSyncConfig`.
- Every plan says what the operation does NOT do: a Live Copy is still editable by cancelling
  inheritance; a lock does not stop its owner.

### Out of Scope

- **ACLs / permissions.** "Nobody can edit" is an access-control change; it stays with an
  administrator in AEM's security console.
- Rollout, synchronisation, suspend and detach of an existing Live Copy (not explored yet).
- Publishing the new Live Copy (that is `page.publish`, already available).

## Risks

| Risk | Mitigation |
|---|---|
| A deep Live Copy of a large tree is async and may fail partway | The plan names the source and whether sub-pages are included; `aem_get_page` / `aem_list_pages` show the result |
| An agent locks pages and forgets them | Lock owner is visible in `aem_get_page`; `page.unlock` releases them; locks never block the token's own user |
| Rollout configs from a project could push to unexpected targets | Only AEM's four built-in configs unless a project lists its own explicitly |

## Success Criteria

- [x] The three kinds pass the same token matrix as every other kind (forged, expired, reused,
      stale, echo mismatch).
- [x] Validated on a live author: Live Copy created with `cq:LiveSyncConfig` pointing at the
      source; lock owner set and cleared.
