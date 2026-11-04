# Client behaviour matrix: confirming `eds_apply` (task 0.2)

Recorded 2026-10-26 from the clients' current docs and source. Feeds task 5.3
(`docs/eds-onboarding.md`). Items derived from source rather than docs are marked; they may change
between releases.

## Summary

**No client reads `destructiveHint`.** In all three clients, the only way to force a prompt for
one tool is an explicit rule for that tool. VS Code is the only client whose behaviour depends on
an annotation, and the annotation is `readOnlyHint`.

| Client | Prompts on `destructiveHint` by default | Reads annotations | Force "always ask" for `eds_apply` | Bypassed by |
|---|---|---|---|---|
| Claude Code | Not because of the hint. MCP tools prompt in the default mode anyway (the docs do not state this explicitly) | `readOnlyHint` only, to run calls in parallel | `ask` rule `mcp__eds__eds_apply` | Not bypassed by `bypassPermissions` or auto mode. In `dontAsk` mode the call is denied instead |
| VS Code Copilot | Yes, as it does for every tool without `readOnlyHint`. `destructiveHint` is ignored | `readOnlyHint: true` runs the tool with no confirmation | `chat.tools.eligibleForAutoApproval: { "eds_apply": false }` | The Allow all / Autopilot permission levels and `/yolo` |
| opencode | No, the default is `allow` | No | `permission: { "eds_eds_apply": "ask" }` | A saved "always" grant (only `deny` holds against it), and `--auto` |

## Claude Code

`.claude/settings.json` (project) or `~/.claude/settings.json`:

```json
{ "permissions": { "ask": ["mcp__eds__eds_apply"] } }
```

- Rules are evaluated deny → ask → allow, and an ask rule prompts even when an allow rule, including
  a saved "don't ask again", also matches. (Claude Code docs, "Permissions".)
- `bypassPermissions` and auto mode never auto-approve tools matched by an explicit ask rule. In
  `dontAsk` mode such calls are denied. (Claude Code docs, "Permission modes".)
- Server-side alternative: `_meta["anthropic/requiresUserInteraction"]: true` on the tool makes it
  prompt on every call, in every mode, with no "don't ask again" option, and allow rules do not skip
  it. (Claude Code docs, "MCP", section "Require approval for a specific tool"; verified 2026-10-27.)

## VS Code Copilot

User `settings.json` (whether `.vscode/settings.json` also honours this setting is not verified):

```json
{ "chat.tools.eligibleForAutoApproval": { "eds_apply": false } }
```

- The setting makes a tool always require manual approval. (VS Code docs, "Agents → Approvals".)
- *(source)* The key is the bare tool name, not `eds/eds_apply`, so a tool with the same name on
  another server matches the same key. Saved "Always allow" grants and `chat.tools.global.autoApprove`
  are checked after this setting and do not override it. The session auto-approve levels (Allow all,
  Autopilot, `/yolo`) are checked before it and do override it.
  `src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts`
- *(source)* A tool with `readOnlyHint` gets no confirmation, so `eds_plan` and the read tools run
  without a prompt. `src/vs/workbench/contrib/mcp/common/mcpLanguageModelToolContribution.ts`

## opencode

`opencode.json` (project root) or `~/.config/opencode/opencode.json`. The repository has moved from
`sst/opencode` to `anomalyco/opencode`.

```json
{ "permission": { "eds_*": "allow", "eds_eds_apply": "ask" } }
```

- Permission names are `${server}_${tool}`. Rules are last-match-wins, so the specific rule must come
  after the wildcard. <https://opencode.ai/docs/permissions/>, <https://opencode.ai/docs/mcp-servers/>
- *(source)* A saved "always" reply is appended as an `allow` rule and overrides `ask`. Only `deny`
  holds against it. In v2 these grants are stored per project, while the docs say per session.
  `packages/core/src/permission.ts`

## Implications for this change

- `destructiveHint: true` on `eds_apply` is correct metadata, but no client acts on it today. The
  Threat Matrix and proposal were corrected in 1.2 so that they no longer count it as a prompt.
- Decided (design.md D3): `eds_apply` carries `_meta["anthropic/requiresUserInteraction"]: true`,
  so Claude Code prompts on every call with no configuration. The `ask` rule above becomes optional
  for Claude Code. Copilot and opencode still need their per-tool setting.
- The onboarding doc (5.3) must warn about the bypasses: VS Code Allow all/Autopilot/`/yolo`, and
  opencode's saved "always" grants and `--auto`.
