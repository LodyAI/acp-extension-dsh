# acp-extension-dsh contributor guide

This package is the provider-owned integration boundary between ACP and DeepSeek
Harness. Keep it usable without importing Lody packages.

## Ownership

- `src/adapter.ts` owns ACP lifecycle, prompt streaming, model/reasoning changes,
  permission-preset selection, blank-session Agent preset composition, and
  session-scoped mounting of ACP stdio/HTTP servers through `dsh-mcp-client`.
- `src/capabilities.ts` owns the static preflight metadata shared with host UIs.
  Each ACP session must instead derive its model selector from `ctx.llm.listModels()`,
  exact model/reasoning metadata and image admission from `ctx.llm.resolveModelInfo()`,
  and permission labels/options from `ctx.permissionPresets`. The LLM catalog is
  advisory: resolve and expose the configured model even when it is unlisted, and
  never reject a model switch only because it is absent from the catalog. Do not
  pin a default catalog in the generated profile. When `DEEPSEEK_BASE_URL` is set,
  discover its OpenAI-compatible `GET /models` response once per ACP connection,
  resolve those exact ids through Harness, and use the first as the initial model;
  do not add a parallel host-authored model list. Permission knob events can move
  a session to the derived `custom` state outside ACP, so keep both ACP mode and
  config-option state synchronized from the durable Harness events.
  Advertise image input only with a compatible Harness attachment store, persist
  accepted image bytes before queuing the user message, and re-read committed
  assistant images for ACP output. Prompt completion and cancellation keep the
  slot owned until admission, Agent idle, and ordered output delivery quiesce.
- `src/profile.ts` owns the pinned Harness version, the same-release npx package
  closure, and the generated `dsh` profile: the pinned `@deepseek-ai/dsh-base`
  bundle plus a `cordis.patch.yml` overlay that disables telemetry/product rows
  and mounts this adapter as the ACP entry. That entry's `name` is a module
  specifier, so render the adapter path as a `file:` URL: a raw Windows path
  (`C:\...`) parses as the `c:` URL scheme and fails the ESM loader. Keep every
  transitive DSH dependency
  and peer package in that exact-version closure; Harness caret ranges must never
  let npm mix a later release candidate into a cold install. `presets/` is the
  pinned copy of the official `standard`/`ptc`/`minimal`/`cordis` Agent presets;
  update it together with the package list and retain the upstream notice. It is
  excluded from Prettier so the vendored files remain byte-identical to upstream.
  The base bundle mounts `dsh-settings-file`, so settings resolve from
  `$DSH_HOME/settings.yaml` (or `~/.dsh/settings.yaml`); keep its package in the
  exact-version closure because the abstract `dsh-settings` dependency alone
  reads no file.
  The ACP entry must require `settings` so its first capability request cannot
  cache a default catalog before the user document has loaded.
  Keep `dsh-llm-pi-ai` dormant in the host composition and let its settings namespace
  own custom route lifecycle and credential references. ACP model ids must encode the
  exact provider/model pair; never collapse equal model ids or fall back after a route fails.
  Its persistence default matches upstream `zstd`; hosts may select legacy raw
  `none` only after inspecting an existing single-encoding root. A mixed root is
  an error and must never trigger automatic artifact mutation or deletion.
  Keep the SQLite session-query service mounted with `openAt: never`: this ACP
  composition needs its exact-read contract but exposes no full-text search,
  and public Node builds do not reliably include SQLite FTS5.
  Keep the npm-10-compatible `0.1.5-rc.2` closure exact; never use `--force` or
  `--legacy-peer-deps`. Cordis-ecosystem versions are independent: use
  `createDeepSeekHarnessNpxSpecifiers()` and its
  `DEEPSEEK_HARNESS_CORDIS_PACKAGE_VERSIONS`, never append the Harness version.
- `src/capabilities.ts` metadata is authoritative for built-in preset labels exposed
  through ACP. Harness runtime metadata remains authoritative for user presets.
- Hosts own installation caches, data-directory selection, process supervision,
  credentials, and bundling.

- `src/user-questions.ts` translates native questions through standard ACP form
  elicitation and Core metadata. Register its answerer in each ACP Agent scope;
  retain Harness's live-root admission and never route delegated/unowned callers
  to a parent's UI. Queue per session, cancel active/waiting requests on teardown,
  and preserve additive multi-select custom text only after Core answer-notes
  negotiation. Plan-review intent changes presentation, not Plan or permissions.

Change profile and adapter together for selector/service changes. Keep credentials
in the host environment, never generated profiles.

Preserve valid available ACP MCP names; normalize invalid names and suffix
collisions in Harness's process-global tool namespace.
MCP plugin fibers belong to the Agent context and must settle before `session/new`
returns, so failed startup cannot publish a session without its requested tools.
Forward reasoning deltas immediately as ACP thoughts, ending blocks with `\n\n`.
Do not retract/deduplicate retry thoughts or replay final reasoning blocks.
Translate Harness's durable `compaction/start` / `compaction/end` bracket into one
standard ACP tool-call lifecycle. Compaction meaning belongs only in the shared
`_meta.lody.activity` contract from `acp-extension-core`; manual compaction has a
`null` Harness turn owner and automatic compaction has a numeric owner.

The managed profile retains the upstream first-prompt title plugin. Declare Core
`sessionTitle` and forward durable `session/title` events on the session output
queue; map provider/user/fallback sources to generated/explicit/fallback. Never
upgrade a first-message preview to a generated title.

## Tool projection

- `src/tool-calls.ts` projects native durable calls/results and PTC dispatches into
  ACP. Keep state session-local and delivery on the session output queue, including
  attachment reads. Resolve presenters in the calling Agent's scope; malformed or
  absent presentation must not hide native arguments, results, or failures.
- Approval waits for preceding tool updates and carries the known call details.
  Only successful result-time diffs are edit evidence. Missing results at turn
  settlement mean unknown outcome, never success. Do not expose another Agent's
  session events or invent terminal IDs for Harness-owned subprocesses.

## Usage accounting

- Count committed `assistant/message.data.usage` once by durable event sequence,
  never raw usage chunks as well. `request/context` owns the actual model route.
  Preserve cumulative Core model usage across turns, model switches and compaction.
- Pinned Harness input already excludes cache hits; DeepSeek output includes
  reasoning. Split only the latter. Price official routes per request using the
  event timestamp and the dated UTC peak/off-peak table in `src/usage.ts`.
  Unknown models, custom endpoints and missing timestamps keep costs unknown.

## Checks

- Core subagent events require negotiation and native carrier ancestry; child
  permissions retain run attribution. See README for stream limits.

Do not commit generated `dist/`. Retain the `prepare` build hook so consumers
resolve `./dist/*` after installation.

Run `npm run build`, `npm test`, and `npm run format:check` before publishing a
change. Node.js 22 or newer is required.

## Session forks

Use Core `forkAtTurn`/`turnId` and native event prefixes through exact ended turns.
Never round unknown targets, copy open tails, replay a transcript prompt, or alter
source runtime/files. Preserve target cwd/MCP; flush ended prompts and children before success.
Release failed children and identify any possible stored artifact in the error.
See README for scope and native validation.
