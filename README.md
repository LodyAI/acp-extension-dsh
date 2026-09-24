# acp-extension-dsh

ACP session controls and a pinned coding profile for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The package is a Cordis plugin, not a replacement for Harness. It adds ACP model,
reasoning-effort, permission, and agent-preset selectors, accepts inline images
when the selected model declares image input (the default `deepseek-flash` / DeepSeek-V41-Flash does), and mounts ACP-provided stdio or
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

The ACP host mounts Harness's file-backed settings provider. It reads
`$DSH_HOME/settings.yaml`, falling back to `~/.dsh/settings.yaml`, and exposes
user sections to settings-aware plugins. Missing settings preserve composition
defaults; malformed settings documents fail startup instead of being silently ignored.
The `llm-deepseek.models` array replaces the local catalog in full, so retain any
default models and their vision metadata that should remain selectable. For example:

```yaml
llm-deepseek:
  models:
    - id: deepseek-flash
      name: DeepSeek-V41-Flash
      inputModalities: [text, image]
    - id: deepseek-v4-flash
      name: DeepSeek-V4-Flash
    - id: deepseek-v4-pro
      name: DeepSeek-V4-Pro
    - id: deepseek-v4-flash-vision-exp
      name: DeepSeek-V4-Flash-Vision-Exp
      inputModalities: [text, image]
    - id: custom-model
      name: Custom model
```

The provider watches file edits, but ACP model choices are cached per connection.
Reconnect and refresh the host's model capabilities after catalog edits.
`DEEPSEEK_BASE_URL` still selects endpoint discovery: this setting does not merge
local-only model IDs into an endpoint's `/models` response. API credentials remain
in the host environment; generated compositions contain no credentials.

## Token and USD accounting

Core's usage capability reports committed request usage, cumulative per-model
totals and already-included deltas. The pinned Harness 0.1.1-rc.2 supplies usage
on `assistant/message` and actual route metadata on `request/context`; raw stream
chunks are not counted again. No model request or transcript is needed by tests.
Only reported activity in the ACP-owned Harness session is counted; separate
background agents or internal operations without usage events are not invented.

Official [DeepSeek prices](https://api-docs.deepseek.com/quick_start/pricing/),
checked directly on 2026-09-13, are estimated per request at completion time.
Off-peak USD/million tokens (cache miss / hit / output): Flash 0.15 / 0.003 / 0.6;
V4 Pro 0.66 / 0.022 / 1.98. Weekday 01:00–04:00 and 06:00–10:00 UTC are twice
those rates. `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` now alias the
new `deepseek-flash` price. Unknown models/custom endpoints have no estimated cost.
These are list-price estimates, not invoices; cross-boundary requests can differ.
Only the registered `deepseek-official` route at the official endpoint is priced;
an arbitrary provider named `deepseek` is not evidence of official billing.
Publish Core 0.1.5 before releasing this adapter dependency.

## Exports

- `acp-extension-dsh` exports the Cordis plugin: `apply`, `inject`, and `name`.
- `acp-extension-dsh/capabilities` exports the selector vocabulary for host UIs.
- `acp-extension-dsh/profile` exports the pinned Harness version, the
  same-release npx package closure, and `createDeepSeekHarnessProfileFiles`,
  which renders the generated `dsh` profile files.

The host launches the pinned `dsh` executable with
`--profile lody-acp`, writing the generated profile (the `@deepseek-ai/dsh-base`
bundle plus the Lody `cordis.patch.yml` overlay) under
`$DSH_HOME/profiles/lody-acp`. It stages this package's official
`standard`/`ptc`/`minimal`/`cordis` preset snapshot beside the ACP adapter.
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

The optional real-runtime settings regression test uses a preinstalled profile
closure. Install every specifier `createDeepSeekHarnessNpxSpecifiers()` returns
in a separate directory first, then run:

```sh
DSH_TEST_RUNTIME_ROOT=/absolute/runtime/node_modules npm run test:settings-profile
```

The test itself uses isolated temporary homes, synthetic settings, and ACP
initialization/session creation only. It does not install packages, use API keys,
send model requests, or edit the user's Harness home. It checks first-request
catalog visibility, absent settings, invalid YAML, non-mapping settings documents, and
preservation of the settings document. The profile's ACP entry explicitly waits
for `settings` so catalog discovery cannot race the initial file read.

## Plan configuration

Core’s boolean `plan_mode` option is available only when the current Agent preset mounts the native Plan service. It calls `planMode.set`, preserves sandbox/approval settings, and publishes durable Plan changes as config updates. A pending selection is reflected until its next-step commit; Plan is guidance, not a sandbox policy.

## User questions

Each ACP-owned Agent mounts an answerer for Harness `user-questions/request`.
The `standard`, `ptc`, and `cordis` presets expose `ask_user_question`; `minimal`
still does not. Clients must advertise standard `elicitation.form`. The adapter
sends `elicitation/create` with Core `_meta.lody.elicitation` and restores the
original Harness question ids and selected option labels in the tool result.
Free text and single-select Other use the existing replacement-answer flow.

For multi-select, clients advertising Core 0.1.6 `answerNotes` receive a separate
Other note alongside their selections. A collision-free Other option permits
custom-only answers; this synthetic label never reaches the tool result.
Clients without answer notes retain replacement-only Other. Plan-review questions
display the question and full plan detail, preserve the declared approval label,
and do not change Plan Mode or permissions.

Harness owns exact-live/root-agent admission (`CALLER_NOT_LIVE` and
`DELEGATED_CALLER`). Requests queue independently per ACP session. Abort, session
cancel/close, and connection disposal reject pending tools with `ASK_ABORTED`;
decline returns `ASK_DECLINED`, transport failure `ANSWER_FAILED`, and malformed
accepted answers `INVALID_ANSWER`. Cancelled queued requests do not dispatch.
SDK 1.3's `AgentSideConnection` has no per-request cancellation API: an already
sent form may remain visible until the host dismisses it or cancels the turn.
The adapter ignores late answers and releases its local queue immediately.

Run the native tool/service/Cordis/ACP boundary test against the pinned installed
closure (no model requests or credentials):

```sh
npm run build
DSH_TEST_RUNTIME_ROOT=/absolute/runtime/node_modules node --test scripts/user-questions-smoke.mjs
```

## Tool calls

The adapter projects durable Harness `tool/call` and `tool/result` events into
standard ACP tool lifecycles. Each row keeps the tool name, parsed arguments
(or the original malformed JSON), completion/failure status, and native result
payload. Text and stored images become ACP content; unsupported blocks remain
inspectable as JSON. Unavailable attachments produce a visible placeholder.
Permission requests wait for the preceding call notification and include its
name, title, kind, arguments and locations.

Agent-scoped tool presenters supply titles, categories, file locations, terminal
output and successful result-time diffs. Broken or absent presenters fall back
to native data. Call-time diffs are deliberately not published as evidence of an
applied edit, and failed calls retain their native error output.
`tool/ptc-dispatch-start` / `tool/ptc-dispatch` also expose tools inside `run_code`
as separate rows, with native sub-call IDs; result payloads retain their root and
parent IDs. The adapter does not invent a host-specific nesting protocol.

Only the exact ACP-owned session contributes rows. Ordered delivery includes
attachment reads, and prompt settlement drains it before releasing the slot.
A turn that ends without a recorded tool result closes the remaining row as
failed with an explicit unknown-outcome explanation, never invented success.
This does not add child-agent transcript forwarding, token-level tool argument
streaming, or subprocess stdout streaming that the durable tool events lack.

## Session titles

The managed profile enables the upstream first-prompt LLM title plugin. Initialize
advertises Core 0.1.7's `_meta.lody.sessionTitle: { version: 1 }`; clients can skip
a separate title process. Native `session/title` events use the ordered ACP output
queue and map provider/user/fallback provenance to generated/explicit/fallback
`titleSource` metadata. Harness owns generation, persistence and user-name protection.
A failed generation leaves the fallback title; it does not fail the prompt.
