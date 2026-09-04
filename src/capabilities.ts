/** Stable ACP selector vocabulary backed by the composed DeepSeek Harness profile. */
export const DEEPSEEK_HARNESS_PERMISSION_MODES = [
  {
    id: 'read-only',
    name: 'Read-only',
    description: 'Read inside the workspace; protected writes require one-time approval.',
  },
  {
    id: 'workspace-write',
    name: 'Workspace write',
    description: 'Read and write inside the workspace; wider access requires one-time approval.',
  },
  {
    id: 'danger-full-access',
    name: 'Full access',
    description: 'Allow unrestricted file and command access without approval prompts.',
  },
] as const;

/** Upstream DeepSeek connection settings consumed by the provider and ACP discovery. */
export const DEEPSEEK_HARNESS_API_KEY_ENV = 'DEEPSEEK_API_KEY';
export const DEEPSEEK_HARNESS_BASE_URL_ENV = 'DEEPSEEK_BASE_URL';

/** Built-in agent compositions shipped by the official DeepSeek Harness CLI. */
export const DEEPSEEK_HARNESS_AGENT_PRESETS = [
  {
    value: 'standard',
    name: 'Standard mode',
    description:
      'Full coding agent with file editing, shell, search, skills, planning, goals, subagents, and workflows.',
  },
  {
    value: 'code',
    name: 'PTC mode',
    description:
      'Standard capabilities exposed through the Code Mode SDK for multi-step TypeScript programs.',
  },
  {
    value: 'minimal',
    name: 'Minimal mode',
    description: 'Two-tool coding agent with persistent bash and str_replace_editor.',
  },
  {
    value: 'cordis',
    name: 'Creator mode',
    description:
      'Standard capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.',
  },
] as const;
