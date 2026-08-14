# acp-extension-dsh

ACP session controls and a pinned coding profile for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The package is a Cordis plugin, not a replacement for Harness. It adds ACP model,
reasoning-effort, and permission selectors while Harness continues to own model
execution, sandbox enforcement, persistence, and one-shot approvals.

## Exports

- `acp-extension-dsh` exports the Cordis plugin: `apply`, `inject`, and `name`.
- `acp-extension-dsh/capabilities` exports the selector vocabulary for host UIs.
- `acp-extension-dsh/profile` exports the pinned Harness package set and Cordis
  profile builder.

The host is responsible for installing/launching the pinned Harness packages,
providing session storage paths through the exported environment-variable names,
and loading this plugin from its built JavaScript entry.

## Development

```sh
npm install
npm run build
npm test
npm run format:check
```

Node.js 22 or newer is required.
