# acp-extension-dsh

ACP session controls and a pinned coding profile for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

The package is a Cordis plugin, not a replacement for Harness. It adds ACP model,
reasoning-effort, permission, and agent-preset selectors, and mounts ACP-provided
stdio or Streamable HTTP MCP servers into each Harness Agent scope. Harness
continues to own model execution, sandbox enforcement, persistence, preset
composition, tool execution, and one-shot approvals.

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

## Development

```sh
npm install
npm run build
npm test
npm run format:check
```

Node.js 22 or newer is required.
