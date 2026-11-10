# AEM Sites MCP Server Specification

## Purpose

Defines the `hiberus-aem-sites-mcp` server (`packages/aem-sites/src/mcp.ts`): its ten-tool
surface, the plan/apply confirmation flow against an AEM as a Cloud Service Sites author, and the
guards that make writes outside the declared content tree unexpressible.

## Requirements

### Requirement: Ten-Tool Surface

The server MUST expose exactly these tools and no others:

| Tool | read/destructive/idempotent | Use it when |
|---|---|---|
| `aem_list_environments` | true/false/true | you need the configured author environments, which are protected, and whether each has a credential (never the credential) |
| `aem_check_auth` | true/false/true | a call failed with 401/403, or before a batch, to confirm the credential works for an environment |
| `aem_list_pages` | true/false/true | you need the pages under a content root, paginated |
| `aem_get_page` | true/false/true | you need one page's properties, template, lock and replication status |
| `aem_get_replication_status` | true/false/true | you need preview/publish status for up to 100 pages at once |
| `aem_get_sheet` | true/false/true | you need the columns and rows of a sheet page (e.g. the EDS bulk `metadata` sheet) |
| `aem_list_templates` | true/false/true | you are about to plan `page.create` and need the templates allowed under a parent |
| `aem_get_page_tree` | true/false/true | you need the component tree of a page, depth-bounded |
| `aem_plan` | true/false/false | you want to change anything on the author; it computes and returns the change, never writes |
| `aem_apply` | false/true/false | the user has explicitly confirmed a plan in their latest message |

Each description MUST state when to use the tool, not only what it does.

#### Scenario: tools/list matches the declared surface

- GIVEN the running server
- WHEN `tools/list` is called
- THEN it returns exactly the ten names above with the declared annotation triples
- AND `aem_apply` is the only tool with `readOnlyHint: false`

### Requirement: Every Write Goes Through aem_plan and aem_apply

No code path other than `aem_apply` SHALL issue a non-GET request to an author, and `aem_apply`
SHALL issue only requests stored under a valid, unexpired, unused token, byte for byte.

#### Scenario: Forged, expired, reused or stale token

- GIVEN a plan token that is unknown, expired, already applied, or whose fingerprint no longer
  matches the author
- WHEN `aem_apply` is called with it
- THEN no write request is sent
- AND the result names the reason (`unknown-token`, `expired`, `already-applied`, `stale-plan`)

#### Scenario: Echoes must match the plan

- GIVEN a valid token planned for env `stage` and kind `page.publish`
- WHEN `aem_apply` is called with `env: "prod"` or `kind: "page.unpublish"`
- THEN nothing is written and the token is NOT consumed

### Requirement: Plan Result Is Self-Describing

`aem_plan` MUST return `status` (`planned` | `no-changes`), and for `planned`: `token`,
`expiresAt`, `env`, `kind`, `summary`, `changes` (before/after per property or row),
`requests` (method and path only), `warnings`, `confirmationMessage`, `instruction`,
`requiresConfirmTarget`.

#### Scenario: No-op plan returns no token

- GIVEN a page whose `cq:robotsTags` already equals `["noindex","nofollow"]`
- WHEN `aem_plan` is called with `page.set-robots` and the same value
- THEN `status` is `no-changes` and no token is returned

#### Scenario: Publish warns about EDS propagation

- GIVEN any `page.publish` plan with `target` `publish` or `both`
- WHEN the plan is returned
- THEN `warnings` states that publishing to `publish` also publishes to EDS live on an
  EDS-connected author

### Requirement: Write Roots

Every target path of every plan MUST, after normalisation, equal or descend from an entry of
`AEM_WRITE_ROOTS`. A root outside `/content/`, or under `/content/dam`, MUST make the server fail
at startup. Paths containing `..`, `//`, selectors or extensions MUST be rejected at plan time.

#### Scenario: Traversal is rejected

- GIVEN `AEM_WRITE_ROOTS=/content/acme-demo-site-eu`
- WHEN `aem_plan` targets `/content/acme-demo-site-eu/../acme-demo-site-us/en`
- THEN the plan is rejected with `path-outside-write-roots` and no request is read or built

#### Scenario: Missing write roots

- GIVEN `AEM_WRITE_ROOTS` is unset
- WHEN any `aem_plan` is called
- THEN it is rejected with a named error pointing at `docs/aem-sites-onboarding.md`
- AND read tools keep working

### Requirement: Property Allowlist and Operator Ban

`page.set-properties` and `page.create` MUST accept only property names in the built-in allowlist
or listed exactly in `AEM_EXTRA_PROPERTIES`. A name containing `@` or starting with `:` MUST be
rejected regardless of configuration.

#### Scenario: Suffix operator smuggled in a property name

- GIVEN a `page.set-properties` operation with `set: { "jcr:title@MoveFrom": "/content/x" }`
- WHEN `aem_plan` is called
- THEN it is rejected with `forbidden-property-name` and no request is built

#### Scenario: Structural property

- GIVEN `set: { "sling:resourceType": "x" }`
- WHEN `aem_plan` is called
- THEN it is rejected with `forbidden-property-name`

### Requirement: Batches

`batch` MUST take 1–300 operations of the other kinds (never a batch) and MUST, at plan time, run
every builder guard and the protected-publish rule on each, rejecting with the operation's number
and without reading or writing; protected targets MUST require the typed confirmation as any plan.
Its confirmation MUST list every operation and warn that requests are planned when applied. The
token MUST live 60 minutes. Apply MUST plan each operation against the current state when its turn
comes, send its requests, skip one with nothing to change, and stop at the first rejection or failed
request, reporting per operation and how many did not run. When the client sends a
`progressToken`, apply MUST notify progress before each operation and after each request it
sends (total: the number of operations; progress only grows), and a notification the client cannot
take MUST NOT stop the batch.

#### Scenario: A long batch keeps the call alive

- GIVEN a batch whose apply takes longer than the client's idle timeout
- WHEN the client called `aem_apply` with a `progressToken`
- THEN it receives a progress notification at least after every request sent

#### Scenario: A store rebuilt under one confirmation

- GIVEN a batch that creates a page and then sets its properties
- WHEN it is planned
- THEN one confirmation lists both, and nothing is read or written
- AND on apply the second operation is planned after the first created the page

### Requirement: Tree Publish

`page.publish-tree` MUST publish every page at or below `root` (re-checking `${root}/`, since
QueryBuilder matches by prefix), in chunks of at most 100 pages per agent, with the same checks,
warnings and protected-path rule as `page.publish`.

#### Scenario: A sibling sharing the prefix

- GIVEN `/en` and `/en-gb`
- WHEN `page.publish-tree` is planned for `/en`
- THEN no page of `/en-gb` is published

### Requirement: Cloud Configuration

`cq:conf` MUST be in the built-in allowlist. Its value MUST be a plain path below `/conf`
(segments of letters, digits, `_` and `-`), otherwise `invalid-value`; the plan MUST read that
node and reject `not-found` when it does not exist, and MUST warn that `cq:conf` decides the Edge
Delivery Services site and the templates of the page and every page below it.

#### Scenario: Rebinding a recreated store to its site

- GIVEN a store page recreated without `cq:conf`, so it inherits the configuration of its parent
- WHEN `page.set-properties` sets `cq:conf` to the store's existing `/conf/<site>/<store>`
- THEN the plan shows the change and the warning, and its apply writes `cq:conf`
- AND a `cq:conf` naming a missing node is rejected with `not-found` before any write

### Requirement: Protected Environments and Paths

A plan whose env is in `AEM_PROTECTED_ENVS`, or whose targets match `AEM_PROTECTED_PATHS`, MUST set
`requiresConfirmTarget: true`, and `aem_apply` MUST reject it unless `confirmTarget` equals the env
name (protected env) or the matching protected pattern, e.g. `/content/*/en/internal` (protected path).
`page.unpublish` on a protected path is allowed behind that confirmation. `page.publish` targeting a protected
path MUST be rejected at plan time unless `AEM_ALLOW_PROTECTED_PUBLISH=1`.

#### Scenario: Publishing a protected path is blocked

- GIVEN `AEM_PROTECTED_PATHS=/content/*/en/internal/*` and no `AEM_ALLOW_PROTECTED_PUBLISH`
- WHEN `aem_plan` is called with `page.publish` on `/content/acme-demo-site-eu/en/internal/draft`
- THEN the plan is rejected with `protected-path-publish`

### Requirement: Delete Refuses Published Content

`page.delete` MUST be rejected at plan time if the page or any descendant is activated on the
publish agent, naming up to ten of them and the count, so the user can plan `page.unpublish`
first, with or without `force`. The rejection MUST name `allowPublished: true` only as the way
out when that unpublish is refused. With `allowPublished: true` the plan MUST proceed, say so in
its summary and warn, naming the pages, that pages really live stay orphaned on publish. Because
AEM does not record preview state, the plan MUST warn that pages on preview cannot be checked.

#### Scenario: Deleting a live page

- GIVEN a page whose last replication action on `publish` is `Activate`
- WHEN `aem_plan` is called with `page.delete` on it, with or without `force: true`
- THEN it is rejected with `page-is-published`, naming the published paths

#### Scenario: The author refuses the unpublish

- GIVEN a page marked `Activate` whose `page.unpublish` the author answers with 400
- WHEN `aem_plan` is called with `page.delete` and `allowPublished: true`
- THEN the plan lists the page in an orphan warning and its apply deletes it

### Requirement: Forced Delete

`page.delete` MUST send `force=false` unless the operation says `force: true`, which MUST send
`force=true`. A forced plan MUST say so in its summary and MUST warn that pages or Live Copies
referencing the deleted pages are left broken. When an unforced delete is answered 412, the
failure MUST name references as the cause and `force: true` as the way out; a forced one MUST NOT
suggest forcing.

#### Scenario: Deleting a referenced subtree

- GIVEN a store folder whose pages link to each other
- WHEN `page.delete` is applied without `force` and the author answers 412
- THEN the failure says the pages are referenced and to plan again with `force: true`
- AND a plan with `force: true` shows the forced summary and warning, and its apply sends `force=true`

### Requirement: One Bearer Token per Environment

Each environment in `AEM_AUTHORS` MUST authenticate with a single bearer token resolved on every
call from `AEM_TOKEN_<ENV>` or, if unset, from the 0600 credential file `aem-sites-<env>.json`.
The server MUST NOT implement any other authentication scheme.

#### Scenario: Token renewed while the server runs

- GIVEN a server started with an expired token for `stage`
- WHEN the user runs `hiberus-aem-sites auth token set --env stage` and the agent retries
- THEN the next call uses the new token without restarting the server

#### Scenario: aem_check_auth reports an expired token

- GIVEN a `stage` token the author answers with 401
- WHEN `aem_check_auth({ env: "stage" })` is called
- THEN it reports `token-expired-or-invalid` and the remedy command, and never the token

### Requirement: Credentials Never Reach the Model

No tool result, error or log line SHALL contain a token or an
`Authorization` header; the bearer MUST be sent only to the configured author host and MUST NOT
follow a redirect.

#### Scenario: Expired token redirects to login

- GIVEN an expired local development token
- WHEN any tool calls the author and receives a redirect or an HTML login page
- THEN the tool fails with `AemAuthError` naming the env and the remedy
- AND the redirect target is not requested with the bearer

### Requirement: Operation Kinds

`aem_plan`'s `operation.kind` MUST be one of: `page.set-properties`, `component.set-properties`, `page.set-robots`,
`sheet.upsert-row`, `sheet.delete-row`, `page.publish`, `page.publish-tree`, `page.unpublish`, `page.create`,
`page.copy`, `page.move`, `page.delete`, `livecopy.create`, `livecopy.rollout`, `livecopy.set-rollout-configs`,
`conf.create-eds-config`, `page.lock`, `page.unlock`, `batch`. Each branch
is strict: a field a kind does not take is a schema rejection. Every kind MUST pass the same token
matrix (forged, expired, reused, stale, echo mismatch) before any write.

#### Scenario: A field the kind does not take

- GIVEN `{ kind: "page.lock", path, force: true }`
- WHEN `aem_plan` is called
- THEN the input is rejected by the schema and nothing is read

### Requirement: Component Fields

`component.set-properties` MUST take a component node path `<page>/jcr:content/<node>[/<node>…]`
whose page is inside `AEM_WRITE_ROOTS`; `jcr:content` alone MUST be rejected as `invalid-path`.
The node MUST already exist (`not-found` otherwise; it never creates one). Field names MUST be
plain names: a name containing `@`, starting with `:`, carrying a namespace, or one of `name`,
`model`, `filter`, `modelFields`, `key-value` MUST be rejected as `forbidden-property-name`. The plan
MUST send only the fields whose value changes, MUST re-check the node before applying, and MUST
warn that a rollout overwrites an inherited component.

#### Scenario: Fixing a block's configured link

- GIVEN a block at `/content/acme-demo-site-eu/en/cart/jcr:content/root/section/block` whose
  `checkout-url` is `/content/acme-demo-site-eu/en/checkout`
- WHEN `aem_plan` is called with `component.set-properties`, `set: { "checkout-url": "/checkout" }`
- THEN the plan changes only `checkout-url`, posts to the block's node and warns about rollouts

#### Scenario: The node was edited in the editor meanwhile

- GIVEN a plan for that block
- WHEN an author changes the block before `aem_apply`
- THEN `aem_apply` is rejected as `stale-plan` and nothing is written

#### Scenario: A field that binds the node to Universal Editor

- GIVEN `set: { model: "other" }`
- WHEN `aem_plan` is called
- THEN it is rejected with `forbidden-property-name`

### Requirement: Per-Page Robots Uses the Page-Metadata Field

`page.set-robots` MUST write the `robots` text field of the EDS XWalk `page-metadata` model on
`jcr:content` (e.g. `"noindex, nofollow"`), and `null` MUST remove it. `cq:robotsTags` is not
used. A plan whose tokens already equal the page's (as a set, case-insensitive) MUST be
`no-changes`.

#### Scenario: The page field reaches EDS and wins over the metadata sheet

- GIVEN a site whose `metadata` sheet sets `Robots=noindex, nofollow` on `/**`
- WHEN a page's `robots` is set to `noindex, noarchive` and the page is published
- THEN `*.aem.page` and `*.aem.live` serve `<meta name="robots" content="noindex, noarchive">`

### Requirement: Replication State Is What AEM Records

Publish-agent state MUST be read from `cq:lastReplicationAction` / `cq:lastReplicated` (or their
`_publish` copies when the plain ones are absent), and an action without its date MUST be ignored.
Preview-agent state MUST be reported as `not-recorded-by-aem`, because AEM records nothing for it.
`page.unpublish` from preview MUST therefore always be sent; from publish it MUST be skipped for a
page not activated there.

#### Scenario: A copied page that was never published

- GIVEN a page carrying `cq:lastReplicationAction_publish=Activate` with no replication date
- WHEN `aem_get_page` reads it
- THEN its publish state is empty, not `Activate`

### Requirement: Live Copies

`livecopy.create` MUST send the Sites console's `createLiveCopy` command. The source MAY be any
readable page under `/content/`; the destination MUST be inside `AEM_WRITE_ROOTS`, MUST NOT exist,
and MUST NOT be inside or above its source. Rollout configs MUST be among AEM's built-in
`/libs/msm/wcm/rolloutconfigs/{default,pushonmodify,activate,deactivate}` or listed exactly in
`AEM_EXTRA_ROLLOUT_CONFIGS`; the default is `default`. The plan MUST state that inherited content
can still be edited by cancelling inheritance. `aem_get_page` MUST report `liveCopy` (master,
rollout configs, deep) for a Live Copy root.

`livecopy.rollout` MUST send the Sites console's async rollout (`/bin/asynccommand`,
`cmd=rollout`, `operation=asyncRollout`) for one readable source page to 1–100 existing targets
inside `AEM_WRITE_ROOTS`, none of them inside or above the source; `deep` rolls out sub-pages too.
The plan MUST warn that inherited content of the targets is overwritten. Apply MUST wait until
each target's `cq:lastRolledout` differs from its value at plan time, and MUST fail naming the
targets not reached after 5 minutes.

`livecopy.set-rollout-configs` MUST replace the `cq:rolloutConfigs` of an existing Live Copy root
inside `AEM_WRITE_ROOTS` with a Sling POST to its `jcr:content/cq:LiveSyncConfig` node, typed
`String[]`, from the same allowlist as `livecopy.create`. A page without `cq:LiveSyncConfig` MUST
be rejected with `invalid-operation`; the same list MUST return `no-changes`. The plan MUST show the
lists before and after, and MUST warn when the new list includes Push on modify.

`conf.create-eds-config` MUST create a new `/conf` tree strictly below `/conf/<tenant>`, where
`/content/<tenant>` holds a write root, with one Sling POST that writes the tree and
`settings/cloudconfigs` as `sling:Folder`s and `edge-delivery-service-configuration` as a `cq:Page`.
Its fields (owner, ref, project type, edge host, auxiliary scripts, resource type) MUST be copied
from the Edge Delivery configuration of the `like` tree, with only `repo` set to `site`; bookkeeping
MUST NOT be copied. An existing tree MUST be rejected with `already-exists`, unless it already has a
configuration for that site (`no-changes`); a missing parent or `like` configuration with
`not-found`. The plan MUST warn that nothing uses the configuration until a `cq:conf` points at it.

#### Scenario: An Edge Delivery site for the language masters

- GIVEN `/conf/<tenant>/<store>` with an Edge Delivery configuration for a store site
- WHEN `aem_plan` plans `conf.create-eds-config` for `/conf/<tenant>/masters`, site `masters`, like that store
- THEN the plan shows the copied fields with `repo: masters`, posts once to the new tree, and a
  later `page.set-properties` can set `cq:conf` to it

#### Scenario: Push on modify on a store Live Copy

- GIVEN a store Live Copy root with the Standard rollout config
- WHEN `aem_plan` plans `livecopy.set-rollout-configs` with Standard and Push on modify
- THEN the plan shows both lists, posts only to its `cq:LiveSyncConfig` node and warns that every
  saved change of the source is rolled out without review

#### Scenario: Two levels of Live Copies in one batch

- GIVEN a global page, its Live Copy in a vertical and that page's Live Copy in a store
- WHEN a batch rolls out the global page to the vertical, then the vertical page to the store
- THEN the second rollout starts only after the first reached the vertical page

#### Scenario: Destination already taken

- GIVEN a page at `<parent>/<name>`
- WHEN `aem_plan` plans `livecopy.create` onto that name
- THEN it is rejected with `already-exists`

### Requirement: Page Locks Belong to the Token's User

`page.lock` / `page.unlock` MUST read the token's user from `currentuser.json`. A page locked by
another user MUST be rejected with `locked-by-other`, naming the owner, for both kinds. Locking a
page already locked by the token's user, or unlocking a page that is not locked, MUST be
`no-changes`. The lock plan MUST state that the owner can still edit and that permissions are not
changed.

#### Scenario: Someone else's lock

- GIVEN a page whose `jcr:lockOwner` is another user
- WHEN `aem_plan` plans `page.unlock`
- THEN it is rejected with `locked-by-other` and the owner's id

### Requirement: Reads Stay Inside Site Content

Read tools MUST accept only page paths under `/content/` and outside `/content/dam`, even though
reads are not limited to the write roots.

#### Scenario: Reading a user's home

- GIVEN `aem_get_page` with `path: "/home/users/x"`
- WHEN it is called
- THEN it fails with `PathNotReadableError` and nothing is requested
