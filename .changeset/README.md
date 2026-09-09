# Changesets

This directory holds changesets — see the [changesets documentation](https://github.com/changesets/changesets) for details.

Run `pnpm changeset` to record a change before merging a PR that should trigger a version bump. `pnpm changeset version` applies pending changesets; `pnpm changeset publish` publishes packages whose `private` field is `false` and whose version was bumped.
