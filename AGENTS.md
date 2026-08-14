# acp-extension-dsh contributor guide

This package is the provider-owned integration boundary between ACP and DeepSeek
Harness. Keep it usable without importing Lody packages.

## Ownership

- `src/adapter.ts` owns ACP lifecycle, prompt streaming, model/reasoning changes,
  permission-preset selection, and blank-session Agent preset composition.
- `src/capabilities.ts` owns the selector vocabulary shared with host UIs.
- `src/profile.ts` owns the pinned Harness version, explicit npx package closure,
  and ACP host-plane composition. `presets/` is the pinned copy of the official
  `standard`/`code`/`minimal`/`cordis` Agent presets; update it together with the
  package list and retain the upstream notice.
- Hosts own installation caches, data-directory selection, process supervision,
  credentials, and bundling.

The profile and adapter must change together when a selector or Harness service
contract changes. Credentials must remain in the host environment and must never
be rendered into a generated profile.

## Checks

Run `npm run build`, `npm test`, and `npm run format:check` before publishing a
change. Node.js 22 or newer is required.
