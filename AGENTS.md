# acp-extension-dsh contributor guide

This package is the provider-owned integration boundary between ACP and DeepSeek
Harness. Keep it usable without importing Lody packages.

## Ownership

- `src/adapter.ts` owns ACP lifecycle, prompt streaming, model/reasoning changes,
  and permission-preset selection.
- `src/capabilities.ts` owns the selector vocabulary shared with host UIs.
- `src/profile.ts` owns the pinned Harness version, exact plugin package list,
  and Cordis coding profile.
- Hosts own installation caches, data-directory selection, process supervision,
  credentials, and bundling.

The profile and adapter must change together when a selector or Harness service
contract changes. Credentials must remain in the host environment and must never
be rendered into a generated profile.

## Checks

Run `npm run build`, `npm test`, and `npm run format:check` before publishing a
change. Node.js 22 or newer is required.
