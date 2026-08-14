export const ACP_EXTENSION_DSH_VERSION = '0.1.0';
export const DEEPSEEK_HARNESS_VERSION = '0.1.0-rc.6';
export const ACP_EXTENSION_DSH_PROFILE_REVISION = 'v1';
export const ACP_EXTENSION_DSH_SESSION_ROOT_ENV = 'ACP_EXTENSION_DSH_SESSION_ROOT';
export const ACP_EXTENSION_DSH_QUERY_PATH_ENV = 'ACP_EXTENSION_DSH_QUERY_PATH';

export const ACP_EXTENSION_DSH_CAPABILITY_SOURCE_VERSION = `acp-extension-dsh@${ACP_EXTENSION_DSH_VERSION}:dsh@${DEEPSEEK_HARNESS_VERSION}:profile-${ACP_EXTENSION_DSH_PROFILE_REVISION}`;

// Keep the ACP entry package first. Hosts can use the first --package spec to
// inspect and repair multi-package npx installs.
export const DEEPSEEK_HARNESS_NPX_PACKAGES = [
  '@deepseek-ai/dsh-acp-demo',
  '@deepseek-ai/dsh-agent-spine-demo',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-session-checkpoint-policy',
  '@deepseek-ai/dsh-session-query-sqlite',
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-sandbox-local',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-bash-sandbox',
  '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-permission-presets',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-fs-sandbox',
  '@deepseek-ai/dsh-fs-observation-policy',
  '@deepseek-ai/dsh-tool-fs',
] as const;

/** Build the immutable Cordis coding profile consumed by dsh-acp-demo. */
export function createDeepSeekHarnessCordisConfig(adapterPath: string): string {
  return `# Generated for acp-extension-dsh. API credentials stay in the host environment.
- id: agent-spine
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    workspaceContext:
      maxBytes: 65536
    skills:
      enabled: false
    toolJobs: false
    goals: false
    persona: |
      You are a coding assistant powered by the {{model}} model. Your working directory is {{cwd}}.

      Verify your work by running the relevant code or tests. Keep answers brief and factual.

- id: session-persistence
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: !!js process.env.${ACP_EXTENSION_DSH_SESSION_ROOT_ENV}
    compression: none

- id: session-checkpoint
  name: '@deepseek-ai/dsh-session-checkpoint-policy'

- id: session-query
  name: '@deepseek-ai/dsh-session-query-sqlite'
  config:
    path: !!js process.env.${ACP_EXTENSION_DSH_QUERY_PATH_ENV}

- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    thinking: enabled
    reasoningEffort: max
    models:
      - id: deepseek-v4-flash
      - id: deepseek-v4-pro

- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'

- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: workspace-write
    workspaceRoot: !!js process.cwd()

- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'

- id: bash
  name: '@deepseek-ai/dsh-bash-sandbox'
  config:
    timeoutMs: 60000

- id: approval
  name: '@deepseek-ai/dsh-user-approval'
  config:
    policy: ask

- id: permission-presets
  name: '@deepseek-ai/dsh-permission-presets'
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

- id: acp-agent
  name: ${JSON.stringify(adapterPath)}
  config:
    provider: deepseek-official
    model: deepseek-v4-pro
    reasoningEffort: max

- id: token-meter
  name: '@deepseek-ai/dsh-token-meter'

- id: compaction-basic
  name: '@deepseek-ai/dsh-compaction-basic'
  config:
    thresholdRatio: 0.8
    retainRatio: 0.08
    maxTokens: 8192
    compactionRetries: 1

- id: fs-sandbox
  name: '@deepseek-ai/dsh-fs-sandbox'
  config:
    cwd: !!js process.cwd()

- id: fs-observation-policy
  name: '@deepseek-ai/dsh-fs-observation-policy'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'
`;
}
