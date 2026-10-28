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
first. Because AEM does not record preview state, the plan MUST warn that pages on preview cannot
be checked.

#### Scenario: Deleting a live page

- GIVEN a page whose last replication action on `publish` is `Activate`
- WHEN `aem_plan` is called with `page.delete` on it
- THEN it is rejected with `page-is-published`, naming the published paths

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

`aem_plan`'s `operation.kind` MUST be one of: `page.set-properties`, `page.set-robots`,
`sheet.upsert-row`, `sheet.delete-row`, `page.publish`, `page.unpublish`, `page.create`,
`page.copy`, `page.move`, `page.delete`, `livecopy.create`, `page.lock`, `page.unlock`. Each branch
is strict: a field a kind does not take is a schema rejection. Every kind MUST pass the same token
matrix (forged, expired, reused, stale, echo mismatch) before any write.

#### Scenario: A field the kind does not take

- GIVEN `{ kind: "page.delete", path, force: true }`
- WHEN `aem_plan` is called
- THEN the input is rejected by the schema and nothing is read

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
