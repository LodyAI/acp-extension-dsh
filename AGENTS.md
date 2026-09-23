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
  Its persistence default matches upstream `zstd`; hosts may select legacy raw
  `none` only after inspecting an existing single-encoding root. A mixed root is
  an error and must never trigger automatic artifact mutation or deletion.
  Keep the SQLite session-query service mounted with `openAt: never`: this ACP
  composition needs its exact-read contract but exposes no full-text search,
  and public Node builds do not reliably include SQLite FTS5.
  The `0.1.5-rc.2` package family cold-installs under npm 10 with the complete
  same-version closure. Keep the closure exact and do not add `--force` or
  `--legacy-peer-deps`; either would hide a future peer-graph regression. The
  Cordis-ecosystem entries in `DEEPSEEK_HARNESS_CORDIS_PACKAGE_VERSIONS` are the
  exception: they publish on their own release lines, so the launcher must
  install them from `createDeepSeekHarnessNpxSpecifiers()` instead of appending
  `DEEPSEEK_HARNESS_VERSION`. Requesting one at the Harness release fails the
  cold install with `ETARGET`, so never "simplify" the closure back to a single
  version.
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

The profile and adapter must change together when a selector or Harness service
contract changes. Credentials must remain in the host environment and must never
be rendered into a generated profile.

ACP MCP server names become Harness tool namespaces. Preserve an already-valid,
available name; normalize invalid names and suffix concurrent collisions so two
live ACP sessions cannot contend for the native client's process-global namespace.
MCP plugin fibers belong to the Agent context and must settle before `session/new`
returns, so failed startup cannot publish a session without its requested tools.
Forward `assistant/chunk` reasoning deltas immediately as ACP thought chunks and emit
`\n\n` when their reasoning block ends, matching Lody's semantic thought-section
separator. Harness may retry after emitting them, and the adapter intentionally does
not retract or deduplicate those already-visible thoughts; do not replay final reasoning
blocks.
Translate Harness's durable `compaction/start` / `compaction/end` bracket into one
standard ACP tool-call lifecycle. Compaction meaning belongs only in the shared
`_meta.lody.activity` contract from `acp-extension-core`; manual compaction has a
`null` Harness turn owner and automatic compaction has a numeric owner.

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

`dist/` is generated, not committed; `prepare` runs `npm run build` during
install so workspace consumers can resolve the `./dist/*` runtime exports. Keep
that hook when changing the build.

Run `npm run build`, `npm test`, and `npm run format:check` before publishing a
change. Node.js 22 or newer is required.
