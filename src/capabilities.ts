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

export const DEEPSEEK_HARNESS_MODELS = [
  {
    modelId: 'deepseek-v4-flash',
    name: 'DeepSeek-V4-Flash',
    description: 'Faster DeepSeek Harness coding model.',
  },
  {
    modelId: 'deepseek-v4-pro',
    name: 'DeepSeek-V4-Pro',
    description: 'More capable DeepSeek Harness coding model.',
  },
] as const;

export const DEEPSEEK_HARNESS_REASONING_OPTIONS = [
  { value: 'off', name: 'Off', description: 'Disable extended thinking' },
  { value: 'high', name: 'High', description: 'Use the standard reasoning budget' },
  { value: 'max', name: 'Max', description: 'Use the maximum reasoning budget' },
] as const;
