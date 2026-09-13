/**
 * DeepSeek Harness composition contract for the Lody ACP host.
 *
 * Lody runs the DeepSeek Harness profile/bundle launcher: `dsh --profile <name>`
 * composes the pinned `@deepseek-ai/dsh-base` bundle under
 * `$DSH_HOME/profiles/<name>` and then applies the generated
 * `cordis.patch.yml` overlay. That overlay removes product/telemetry rows and
 * mounts this package's adapter as the ACP entry point, so the host keeps the
 * upstream base composition without inheriting the web product surface.
 */
export const ACP_EXTENSION_DSH_VERSION = '0.2.0';
export const DEEPSEEK_HARNESS_VERSION = '0.1.5-rc.2';
export const ACP_EXTENSION_DSH_PROFILE_REVISION = 'v11';
export const ACP_EXTENSION_DSH_SESSION_ROOT_ENV = 'ACP_EXTENSION_DSH_SESSION_ROOT';
export const ACP_EXTENSION_DSH_QUERY_PATH_ENV = 'ACP_EXTENSION_DSH_QUERY_PATH';
export const DEEPSEEK_HARNESS_DEFAULT_SESSION_COMPRESSION = 'zstd';
/** Profile directory name resolved under `$DSH_HOME/profiles`. */
export const DEEPSEEK_HARNESS_PROFILE_NAME = 'lody-acp';
/** Bundle layers the generated profile composes, in order. */
export const DEEPSEEK_HARNESS_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base'];
/** Provider route and default model pinned for new sessions. */
export const DEEPSEEK_HARNESS_PROVIDER = 'deepseek-official';
export const DEEPSEEK_HARNESS_DEFAULT_MODEL = 'deepseek-flash';
export const ACP_EXTENSION_DSH_CAPABILITY_SOURCE_VERSION = `acp-extension-dsh@${ACP_EXTENSION_DSH_VERSION}:dsh@${DEEPSEEK_HARNESS_VERSION}:profile-${ACP_EXTENSION_DSH_PROFILE_REVISION}`;
/**
 * Exact same-version package closure for the launcher install. The Harness
 * packages publish caret ranges, so every package the composed profile or a
 * shipped Agent preset can resolve is named here with the same release; the
 * first entry owns the `dsh` binary.
 */
export const DEEPSEEK_HARNESS_NPX_PACKAGES = [
    '@deepseek-ai/dsh',
    '@deepseek-ai/cordis',
    '@deepseek-ai/cordis-plugin-group',
    '@deepseek-ai/cordis-plugin-hmr',
    '@deepseek-ai/cordis-plugin-include',
    '@deepseek-ai/cordis-plugin-loader',
    '@deepseek-ai/cordis-plugin-timer',
    '@deepseek-ai/dsh-acp',
    '@deepseek-ai/dsh-acp-app',
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-agent-default-model',
    '@deepseek-ai/dsh-agent-instructions',
    '@deepseek-ai/dsh-agent-loop',
    '@deepseek-ai/dsh-agent-presets',
    '@deepseek-ai/dsh-agent-tool-presentation',
    '@deepseek-ai/dsh-anonymous-user-id',
    '@deepseek-ai/dsh-api-gateway',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-api-settings-controller',
    '@deepseek-ai/dsh-api-workspace-controller',
    '@deepseek-ai/dsh-api-workspace-files',
    '@deepseek-ai/dsh-app-boot',
    '@deepseek-ai/dsh-atomic-write',
    '@deepseek-ai/dsh-attachment',
    '@deepseek-ai/dsh-attachment-local',
    '@deepseek-ai/dsh-authorization',
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-bash-local',
    '@deepseek-ai/dsh-bash-sandbox',
    '@deepseek-ai/dsh-brand',
    '@deepseek-ai/dsh-chunked-list',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-file-upload',
    '@deepseek-ai/dsh-client-hmr',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-modules',
    '@deepseek-ai/dsh-client-resources',
    '@deepseek-ai/dsh-client-ui-agent-preset',
    '@deepseek-ai/dsh-client-ui-approval',
    '@deepseek-ai/dsh-client-ui-attachment',
    '@deepseek-ai/dsh-client-ui-brand-official',
    '@deepseek-ai/dsh-client-ui-chat',
    '@deepseek-ai/dsh-client-ui-commands',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-cordis',
    '@deepseek-ai/dsh-client-ui-deliverables',
    '@deepseek-ai/dsh-client-ui-directory-picker-browse',
    '@deepseek-ai/dsh-client-ui-directory-picker-native',
    '@deepseek-ai/dsh-client-ui-goal',
    '@deepseek-ai/dsh-client-ui-input-trigger',
    '@deepseek-ai/dsh-client-ui-jobs',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-message-feedback',
    '@deepseek-ai/dsh-client-ui-model-selection',
    '@deepseek-ai/dsh-client-ui-open-in-app',
    '@deepseek-ai/dsh-client-ui-permission-presets',
    '@deepseek-ai/dsh-client-ui-plan',
    '@deepseek-ai/dsh-client-ui-reference',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-schedule',
    '@deepseek-ai/dsh-client-ui-session',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-settings-general',
    '@deepseek-ai/dsh-client-ui-settings-models',
    '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
    '@deepseek-ai/dsh-client-ui-settings-plugins',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-sidebar-documentpreview',
    '@deepseek-ai/dsh-client-ui-sidebar-files',
    '@deepseek-ai/dsh-client-ui-sidebar-right',
    '@deepseek-ai/dsh-client-ui-skill',
    '@deepseek-ai/dsh-client-ui-subagent',
    '@deepseek-ai/dsh-client-ui-theme',
    '@deepseek-ai/dsh-client-ui-tool',
    '@deepseek-ai/dsh-client-ui-trajectory',
    '@deepseek-ai/dsh-client-ui-user-questions',
    '@deepseek-ai/dsh-client-ui-workflow-run',
    '@deepseek-ai/dsh-client-ui-workspace',
    '@deepseek-ai/dsh-cmdline',
    '@deepseek-ai/dsh-code-runtime',
    '@deepseek-ai/dsh-code-runtime-worker-thread',
    '@deepseek-ai/dsh-command-compact',
    '@deepseek-ai/dsh-command-feedback',
    '@deepseek-ai/dsh-command-goal',
    '@deepseek-ai/dsh-commands',
    '@deepseek-ai/dsh-compaction',
    '@deepseek-ai/dsh-compaction-basic',
    '@deepseek-ai/dsh-compaction-tool-result-pruner',
    '@deepseek-ai/dsh-cordis-client-runner',
    '@deepseek-ai/dsh-cordis-host-runner',
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/dsh-credentials-local',
    '@deepseek-ai/dsh-deepseek-llm-api-extensions',
    '@deepseek-ai/dsh-deque',
    '@deepseek-ai/dsh-file-reference',
    '@deepseek-ai/dsh-file-reference-local',
    '@deepseek-ai/dsh-fs',
    '@deepseek-ai/dsh-fs-local',
    '@deepseek-ai/dsh-fs-observation-policy',
    '@deepseek-ai/dsh-fs-sandbox',
    '@deepseek-ai/dsh-goal',
    '@deepseek-ai/dsh-goal-round-driver',
    '@deepseek-ai/dsh-headless',
    '@deepseek-ai/dsh-home-paths',
    '@deepseek-ai/dsh-hook-protocol',
    '@deepseek-ai/dsh-hooks-claude-code',
    '@deepseek-ai/dsh-hooks-codex',
    '@deepseek-ai/dsh-host-directory-picker',
    '@deepseek-ai/dsh-host-directory-picker-auto',
    '@deepseek-ai/dsh-host-directory-picker-browse',
    '@deepseek-ai/dsh-host-directory-picker-native',
    '@deepseek-ai/dsh-host-frontend-static',
    '@deepseek-ai/dsh-host-open-in-app',
    '@deepseek-ai/dsh-host-plugin-inventory',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-http-proxy',
    '@deepseek-ai/dsh-invariants',
    '@deepseek-ai/dsh-jobs',
    '@deepseek-ai/dsh-jobs-local',
    '@deepseek-ai/dsh-launch-environment',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-llm-deepseek',
    '@deepseek-ai/dsh-llm-pi-ai',
    '@deepseek-ai/dsh-llm-retry',
    '@deepseek-ai/dsh-mcp-client',
    '@deepseek-ai/dsh-message-feedback',
    '@deepseek-ai/dsh-native-command',
    '@deepseek-ai/dsh-output-retention',
    '@deepseek-ai/dsh-package-manifest',
    '@deepseek-ai/dsh-permission-presets',
    '@deepseek-ai/dsh-persona',
    '@deepseek-ai/dsh-plan-mode',
    '@deepseek-ai/dsh-plugin-package-inventory-deepseek',
    '@deepseek-ai/dsh-pwsh-local',
    '@deepseek-ai/dsh-pwsh-sandbox',
    '@deepseek-ai/dsh-repeat-tool-reminder',
    '@deepseek-ai/dsh-sandbox',
    '@deepseek-ai/dsh-sandbox-local',
    '@deepseek-ai/dsh-sandbox-policy',
    '@deepseek-ai/dsh-sandbox-windows-acl',
    '@deepseek-ai/dsh-schedule',
    '@deepseek-ai/dsh-scope',
    '@deepseek-ai/dsh-sdk-app',
    '@deepseek-ai/dsh-sdk-jsonrpc-server',
    '@deepseek-ai/dsh-sdk-minimal',
    '@deepseek-ai/dsh-sdk-protocol',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-checkpoint-policy',
    '@deepseek-ai/dsh-session-format',
    '@deepseek-ai/dsh-session-format-catalog',
    '@deepseek-ai/dsh-session-format-v0-to-v1',
    '@deepseek-ai/dsh-session-format-v1-to-v2',
    '@deepseek-ai/dsh-session-format-v2-to-v3',
    '@deepseek-ai/dsh-session-log-deepseek',
    '@deepseek-ai/dsh-session-log-export',
    '@deepseek-ai/dsh-session-persistence',
    '@deepseek-ai/dsh-session-persistence-jsonl',
    '@deepseek-ai/dsh-session-projection',
    '@deepseek-ai/dsh-session-projection-cache',
    '@deepseek-ai/dsh-session-query',
    '@deepseek-ai/dsh-session-query-sqlite',
    '@deepseek-ai/dsh-session-reference',
    '@deepseek-ai/dsh-session-stats',
    '@deepseek-ai/dsh-session-telemetry',
    '@deepseek-ai/dsh-session-telemetry-otel',
    '@deepseek-ai/dsh-session-title',
    '@deepseek-ai/dsh-session-title-first-prompt-llm',
    '@deepseek-ai/dsh-session-title-llm',
    '@deepseek-ai/dsh-session-turn-outline',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-settings-file',
    '@deepseek-ai/dsh-shell',
    '@deepseek-ai/dsh-shell-env',
    '@deepseek-ai/dsh-skill',
    '@deepseek-ai/dsh-skill-badge',
    '@deepseek-ai/dsh-skill-filesystem',
    '@deepseek-ai/dsh-spill',
    '@deepseek-ai/dsh-spill-local',
    '@deepseek-ai/dsh-spill-policy',
    '@deepseek-ai/dsh-storage',
    '@deepseek-ai/dsh-storage-domain',
    '@deepseek-ai/dsh-storage-json',
    '@deepseek-ai/dsh-subagent',
    '@deepseek-ai/dsh-subagent-fork-in-process',
    '@deepseek-ai/dsh-subagent-in-process-driver',
    '@deepseek-ai/dsh-subagent-spawn-in-process',
    '@deepseek-ai/dsh-subprocess',
    '@deepseek-ai/dsh-subprocess-local',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-terminal',
    '@deepseek-ai/dsh-terminal-bash',
    '@deepseek-ai/dsh-time-context',
    '@deepseek-ai/dsh-timeout',
    '@deepseek-ai/dsh-tmux-context',
    '@deepseek-ai/dsh-token-meter',
    '@deepseek-ai/dsh-tool-ask-user',
    '@deepseek-ai/dsh-tool-bash',
    '@deepseek-ai/dsh-tool-bash-persistent',
    '@deepseek-ai/dsh-tool-call-timeout-policy',
    '@deepseek-ai/dsh-tool-cordis',
    '@deepseek-ai/dsh-tool-fs',
    '@deepseek-ai/dsh-tool-fs-search',
    '@deepseek-ai/dsh-tool-goal',
    '@deepseek-ai/dsh-tool-jobs',
    '@deepseek-ai/dsh-tool-present',
    '@deepseek-ai/dsh-tool-pwsh',
    '@deepseek-ai/dsh-tool-pwsh-persistent',
    '@deepseek-ai/dsh-tool-ralph',
    '@deepseek-ai/dsh-tool-skill',
    '@deepseek-ai/dsh-tool-str-replace-editor',
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-tool-subagent-control',
    '@deepseek-ai/dsh-tool-todo',
    '@deepseek-ai/dsh-tool-web',
    '@deepseek-ai/dsh-tool-workflow',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-typert-loader',
    '@deepseek-ai/dsh-typert-protocol',
    '@deepseek-ai/dsh-typert-registry',
    '@deepseek-ai/dsh-user-approval',
    '@deepseek-ai/dsh-user-questions',
    '@deepseek-ai/dsh-util-crypto',
    '@deepseek-ai/dsh-util-time',
    '@deepseek-ai/dsh-util-values',
    '@deepseek-ai/dsh-util-workspace-path',
    '@deepseek-ai/dsh-web',
    '@deepseek-ai/dsh-web-app',
    '@deepseek-ai/dsh-web-fetch-http',
    '@deepseek-ai/dsh-web-frontend',
    '@deepseek-ai/dsh-web-search-deepseek',
    '@deepseek-ai/dsh-webhook',
    '@deepseek-ai/dsh-webhook-github',
    '@deepseek-ai/dsh-win32-process',
    '@deepseek-ai/dsh-workflow',
    '@deepseek-ai/dsh-workflow-worker-thread',
    '@deepseek-ai/dsh-workspace',
];
const PROFILE_PNPM_WORKSPACE = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n';
/** Build the profile files without touching the filesystem. */
export function createDeepSeekHarnessProfileFiles(config) {
    const provider = config.provider?.trim() || DEEPSEEK_HARNESS_PROVIDER;
    const model = config.model?.trim() || DEEPSEEK_HARNESS_DEFAULT_MODEL;
    const compression = config.sessionCompression ?? DEEPSEEK_HARNESS_DEFAULT_SESSION_COMPRESSION;
    const adapterPath = JSON.stringify(config.adapterPath);
    const presetRoot = JSON.stringify(config.presetRoot);
    const packageJson = JSON.stringify({
        name: `dsh-profile-${DEEPSEEK_HARNESS_PROFILE_NAME}`,
        private: true,
        dependencies: {},
        dsh: {
            profile: {
                bundles: [...DEEPSEEK_HARNESS_PROFILE_BUNDLES],
                patchReload: 'startup',
            },
        },
    }, null, 2) + '\n';
    const cordisYml = '[]\n';
    const cordisPatchYml = `# Generated by acp-extension-dsh ${ACP_EXTENSION_DSH_VERSION} for DeepSeek Harness ${DEEPSEEK_HARNESS_VERSION}.
# API credentials stay in the host environment; never inline them here.

# The ACP host owns no telemetry or product inventory rows.
- id: session-telemetry-otel
  disabled: true

- id: plugin-package-inventory-deepseek
  disabled: true

- id: session-log-deepseek
  disabled: true

# Titles come from the client; do not spend a model call on the first prompt.
- id: session-title-llm
  disabled: true

# Keep sessions and the exact-read query index on Lody's own roots.
- id: session-persistence-jsonl
  config:
    root: !!js process.env.${ACP_EXTENSION_DSH_SESSION_ROOT_ENV}
    compression: ${compression}

- id: session-query-sqlite
  config:
    path: !!js process.env.${ACP_EXTENSION_DSH_QUERY_PATH_ENV}
    openAt: never

# The agent factory default for any preset-created child.
- id: agent-default-model
  config:
    provider: ${JSON.stringify(provider)}
    model: ${JSON.stringify(model)}

# Preserve the product's three permission modes with client-facing labels.
- id: permission
  config:
    defaultPreset: workspace-write
    presets:
      read-only:
        sandbox: read-only
        approval: ask
        name: Read-only
        description: Read inside the workspace; protected writes require one-time approval.
      workspace-write:
        sandbox: workspace-write
        approval: ask
        name: Workspace write
        description: Read and write inside the workspace; wider access requires one-time approval.
      danger-full-access:
        sandbox: danger-full-access
        approval: never
        name: Full access
        description: Allow unrestricted file and command access without approval prompts.

- insert:
    - id: agent-presets
      name: '@deepseek-ai/dsh-agent-presets'
      config:
        default: standard
        includeShippedRoot: false
        includeUserRoot: true
        roots:
          - path: ${presetRoot}
            trust: system

    # The shipped presets' delegation group resolves this host-scope opt-in.
    - id: subagent-model-selection-settings
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'

    - id: acp-agent
      name: ${adapterPath}
      inject: [settings]
      config:
        provider: ${JSON.stringify(provider)}
        model: ${JSON.stringify(model)}${config.reasoningEffort ? `\n        reasoningEffort: ${JSON.stringify(config.reasoningEffort)}` : ''}
`;
    return { packageJson, cordisYml, cordisPatchYml, pnpmWorkspaceYaml: PROFILE_PNPM_WORKSPACE };
}
/**
 * A profile directory must exist before the launcher resolves it. The caller
 * writes these files under `$DSH_HOME/profiles/<DEEPSEEK_HARNESS_PROFILE_NAME>`.
 */
export const DEEPSEEK_HARNESS_PROFILE_FILENAMES = {
    packageJson: 'package.json',
    cordisYml: 'cordis.yml',
    cordisPatchYml: 'cordis.patch.yml',
    pnpmWorkspaceYaml: 'pnpm-workspace.yaml',
};
//# sourceMappingURL=profile.js.map