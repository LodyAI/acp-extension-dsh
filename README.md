# acp-extension-dsh

ACP session controls and a pinned coding profile for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The package is a Cordis plugin, not a replacement for Harness. It adds ACP model,
reasoning-effort, permission, and agent-preset selectors, accepts inline images
when `DeepSeek-V4-Flash-Vision-Exp` is selected, and mounts ACP-provided stdio or
Streamable HTTP MCP servers into each Harness Agent scope. Harness
continues to own model execution, sandbox enforcement, persistence, preset
composition, tool execution, and one-shot approvals.

The adapter advertises Core's `_meta.lody.compaction` capability and translates
Harness `compaction/start` and `compaction/end` events into a standard ACP tool
lifecycle carrying `_meta.lody.activity`. Manual and automatic compaction remain
distinguishable, and failed compactions keep the Harness error reason.
Committed assistant images are read back through the attachment store and sent as
ACP image blocks. Prompt completion and cancellation wait for admission, Harness
idle, and ordered output delivery before releasing the session's prompt slot.

ACP model choices are discovered from Harness when each session is created and
returned through both the standard `model` config option and the legacy ACP
`models` response. Exact per-model metadata controls the reasoning selector and
image admission, and the legacy response carries `model[effort]` entries so a
host can cache the reasoning choices for every model rather than only the model
that happened to be active during the probe. Permission choices use the composed
Harness preset table.
When `DEEPSEEK_BASE_URL` is set, the adapter requests its OpenAI-compatible
`GET /models` endpoint once per ACP connection, resolves every advertised id
through Harness, and selects the first result initially. Discovery is bounded,
does not follow redirects, and reports an actionable startup failure when the
endpoint cannot provide a usable list. Without an endpoint, the Harness catalog
remains advisory: an explicitly configured or selected model is still resolved
even when it is not listed.

## Exports

- `acp-extension-dsh` exports the Cordis plugin: `apply`, `inject`, and `name`.
- `acp-extension-dsh/capabilities` exports the selector vocabulary for host UIs.
- `acp-extension-dsh/profile` exports the pinned Harness package set and ACP
  host-composition builder.

The host launches the pinned `dsh-acp-demo` executable with the generated
composition and stages this package's official
`standard`/`code`/`minimal`/`cordis` preset snapshot beside the ACP adapter.
Harness mounts the selected preset per session and also discovers user presets
below `$DSH_HOME/.agent-presets`. MCP tools use Harness's native
`mcp__<server>__<tool>` naming and are removed with their owning ACP session.

The generated profile defaults session persistence to upstream's `zstd`
encoding. A host that reuses an existing Harness session root may pass `none`
to the profile builder only after verifying that the root contains raw
`session.jsonl` artifacts and no `session.jsonl.zstd` artifacts. Harness roots
are single-encoding stores: hosts must refuse mixed roots without moving,
rewriting, or deleting user artifacts.

The ACP profile keeps the session-query service mounted for exact reads but sets
its full-text SQLite index to `openAt: never`. This composition does not expose
the session-search tool, and public Node distributions cannot be assumed to
include SQLite FTS5. Disabling the unused index prevents ACP startup from
depending on that optional SQLite build feature.

## Development

```sh
npm install
npm run build
npm test
npm run format:check
```

Node.js 22 or newer is required.

## Plan configuration

Core’s boolean `plan_mode` option is available only when the current Agent preset mounts the native Plan service. It calls `planMode.set`, preserves sandbox/approval settings, and publishes durable Plan changes as config updates. A pending selection is reflected until its next-step commit; Plan is guidance, not a sandbox policy.
