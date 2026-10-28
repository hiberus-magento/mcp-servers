# AEM Sites onboarding

The day-one sequence for `@hiberus-magento/aem-sites` — the `hiberus-aem-sites`
CLI and the `hiberus-aem-sites-mcp` server. Examples use the synthetic
identifiers from `packages/mcp-testing/src/fixtures/synthetic-identifiers.ts`
(`acme-demo-site-eu`) and a placeholder author origin — substitute your own.

## Step 1 — declare the authors

One entry per environment you want to reach, `<env>=<author origin>`. Env
names are lowercase letters and digits; they name the token variable too.

```sh
export AEM_AUTHORS="stage=https://author-p<program>-e<environment>.adobeaemcloud.com"
```

Only AEM as a Cloud Service **author** origins are accepted. A publish origin,
a custom domain or anything with a path or port stops the server at startup.

## Step 2 — store a token per environment

In the Developer Console of that AEM environment, open *Integrations → Local
token* and copy it (or download the JSON). Then:

```sh
pbpaste | hiberus-aem-sites auth token set --env stage
```

It reads stdin only — there is no `--token` flag. It accepts the raw token, a
`Bearer `-prefixed one or the downloaded JSON, and writes
`$XDG_CONFIG_HOME/hiberus/aem-sites-stage.json` at mode `0600`.
`AEM_TOKEN_STAGE` wins over the file when both are set.

The local development token **lasts 24 hours**. When it expires every call
answers with an auth error naming this same command; store a new one and
retry — the server re-reads the token on every call, no restart needed.

## Step 3 — check it works

```sh
hiberus-aem-sites auth status
```

Per environment: the author, where the token comes from, and a QueryBuilder
probe — `HTTP 200 OK`, `token-expired-or-invalid`, `forbidden` or
`redirected-to-login`. It never prints the token. The `aem_check_auth` tool
runs the same probe for an agent.

## Step 4 — decide what may be written

```sh
export AEM_WRITE_ROOTS="/content/acme-demo-site-eu"
export AEM_PROTECTED_ENVS="prod"                       # optional
export AEM_PROTECTED_PATHS="/content/*/en/internal"    # optional
```

- Without `AEM_WRITE_ROOTS` every plan is rejected; reads still work.
- A plan touching a protected environment or path needs the user to type the
  env name or the path pattern, and `aem_apply` rejects it otherwise.
- `page.publish` on a protected path is rejected outright unless
  `AEM_ALLOW_PROTECTED_PUBLISH=1`. That is how publication is blocked through
  this server; it does not restrict editors in the Sites console.
- `AEM_EXTRA_PROPERTIES` lists your own page-dialog properties that plans may
  set (exact names; Sling operators and structural properties are refused).

## Step 5 — make your client ask before every apply

`aem_apply` is the only tool that writes. The plan result already tells the
model to show the plan and wait for an explicit yes; a client-side prompt is
the second layer. In Claude Code, add it to the `ask` list of your settings:

```json
{ "permissions": { "ask": ["mcp__hiberus-aem-sites-mcp__aem_apply"] } }
```

## Recipe — block indexing of a whole EDS site sourced from AEM

1. `aem_plan` `sheet.upsert-row` on `/content/acme-demo-site-eu/metadata`,
   `match: { column: "URL", value: "/**" }`, `values: { Robots: "noindex, nofollow" }`
   → show the plan → `aem_apply`. Creates the sheet from the EDS metadata
   template if it does not exist.
2. `aem_plan` `page.publish` of that sheet, `target: "both"` → confirm → apply.
3. With the `eds` server, preview and publish `/metadata.json` for the site.

Per page instead: `page.set-robots` with `["noindex", "nofollow"]`, then
`page.publish`. Whether the EDS pipeline renders `cq:robotsTags` is not yet
verified; the sheet route is the one proven in the field.

## Using the CLI instead of an agent

```sh
echo '{"kind":"page.publish","paths":["/content/acme-demo-site-eu/en"],"target":"both"}' \
  | hiberus-aem-sites apply --env stage --operation -          # prints the plan
... | hiberus-aem-sites apply --env stage --operation - --yes  # applies it
```

`plan` and `apply` without `--yes` never write.
