# Exploration: aem-sites-msm — Live Copies and page locks for `@hiberus-magento/aem-sites`

Spike run on 2026-10-28 against a non-production AEM as a Cloud Service author, before any code.
Trigger: a user asked the agent for "a Live Copy of a page that nobody can edit", which
`aem-sites-package` cannot do (MSM and ACLs were out of scope). Real paths and hosts are not
recorded here (public repository); `<site>` stands for a site root under a write root.

## How the endpoints were found

Read-only first: the Sites console's own definitions on the author.

- `/libs/wcm/core/content/sites/createlivecopywizard` — the "Create → Live Copy" wizard. Its form
  posts to `/bin/wcmcommand` with hidden `cmd=createLiveCopy` and `operation=asyncCreateLiveCopy`,
  and fields `srcPath`, `destPath`, `title`, `label` (page name, `admin.pagename` validation),
  `shallow` (exclude sub-pages) and `cq:rolloutConfigs` (multi-value).
- Rollout configs available (QueryBuilder `type=cq:RolloutConfig`): `/libs/msm/wcm/rolloutconfigs/`
  `default` (Standard rollout config), `pushonmodify`, `activate`, `deactivate`; none under `/apps`
  or `/conf`.
- Lock / unlock are client-side actions (`cq.wcm.lock`, `cq.wcm.unlock`); their JS is not
  searchable on the author, so the endpoint was tried directly.

## Results (writes, each confirmed by the user beforehand)

| Request | Response | Author state after |
|---|---|---|
| `POST /bin/wcmcommand` `cmd=createLiveCopy` `operation=asyncCreateLiveCopy` `srcPath=<site>/index-test` `destPath=<site>` `label=prueba` `title=Prueba` `cq:rolloutConfigs=/libs/msm/wcm/rolloutconfigs/default` | 200, HTML "Live Copy created", Location `<site>/prueba` | `jcr:content` with mixins `cq:LiveRelationship`, `cq:LiveSync`; child `cq:LiveSyncConfig` (`cq:LiveCopy`) with `cq:master=<site>/index-test`, `cq:rolloutConfigs=[default]`, `cq:isDeep=true`; components carry `cq:LiveRelationship`; properties inherited from the source (`robots`, `description`); `jcr:title` given explicitly was recorded in `cq:propertyInheritanceCancelled` |
| `POST /bin/wcmcommand` `cmd=lockPage` `path=<site>/index-test` | 200, "Page locked" | `jcr:lockOwner=<the token's user>`, `jcr:lockIsDeep=true`, mixin `mix:lockable` |
| `POST /bin/wcmcommand` `cmd=unlockPage` `path=<site>/index-test` | 200, "Page unlocked" | lock properties gone (`mix:lockable` stays) |

Same shape as the Live Copies the project's FileVault package already produces (a language branch
that is a Live Copy of its language master).

Responses are HTML status pages, not JSON — the existing `execute` path already treats any 2xx as
success and does not parse the body.

## What this means for "a copy nobody can edit"

- A Live Copy's components are inherited: editing one requires an author to cancel inheritance
  on purpose, and a rollout from the source overwrites inherited content. That is the MSM answer
  to "keep it in step with the source".
- A page lock stops other users from editing, not the lock owner. The token's user owns the
  lock, so anyone holding that token can still edit.
- Neither stops a determined author with the right permissions. Real "nobody can edit" is an ACL,
  which stays out of scope for an agent-facing server.

## Proposed operation kinds (to specify in proposal/design)

| Kind | Request | Guard |
|---|---|---|
| `livecopy.create` | `createLiveCopy` as above; `rolloutConfigs` limited to the four `/libs/msm/wcm/rolloutconfigs/*` (plus an allowlist variable for project configs) | `srcPath` readable, `destPath` + `label` inside write roots, destination absent |
| `page.lock` / `page.unlock` | `lockPage` / `unlockPage` with `path` | path in write roots; unlock only if the lock owner is the token's user (otherwise reject, naming the owner) |

Not yet explored: rollout and sync (`cq:LiveSyncConfig` exists; the console's rollout action
endpoint was not looked up), suspending / detaching a Live Copy, and how the async operation
reports failure for a deep source with many pages.
