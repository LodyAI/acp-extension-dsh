/**
 * ACP surface for DeepSeek Harness.
 *
 * The upstream ACP plugin intentionally exposes only automation basics. This
 * adapter keeps its prompt, lifecycle, cancellation, and one-shot approval
 * behavior while adding standard ACP session controls backed by Harness's
 * per-agent model waterfall and permission-preset service.
 */
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { Readable, Writable } from 'node:stream';

import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Agent as AcpAgent,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseSessionRequest,
  type ContentBlock,
  type InitializeRequest,
  type InitializeResponse,
  type McpServer,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type SessionConfigOption,
  type SessionModeState,
  type SessionNotification,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type StopReason,
  type Stream,
} from '@agentclientprotocol/sdk';
import type { LodyActivityMeta, LodyExtensionCapabilities } from 'acp-extension-core';
import {
  DEEPSEEK_HARNESS_AGENT_PRESETS,
  DEEPSEEK_HARNESS_API_KEY_ENV,
  DEEPSEEK_HARNESS_BASE_URL_ENV,
} from './capabilities.js';
import { ACP_EXTENSION_DSH_VERSION } from './profile.js';

export const name = 'acp-extension-dsh';
// Waiting for persistence/query also preserves the upstream composite's
// startup boundary: ACP cannot accept a session until durability is ready.
export const inject = [
  'agents',
  'agentPresets',
  'attachments',
  'loader',
  'llm',
  'permissionPresets',
  'sessionPersistence',
  'sessionQuery',
];

type ModelSelection = {
  provider: string;
  model: string;
  reasoningEffort?: string;
};

type ModelSelectionRef = {
  current: ModelSelection;
  assembled?: ModelSelection;
};

type HarnessRequestConfig = Record<string, unknown> & {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
};

type HarnessPromptAssembly = Record<string, unknown> & {
  variables?: Record<string, unknown>;
};

type HarnessTextBlock = { type: 'text'; text: string };
type HarnessImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
type HarnessImageAttachmentRef = {
  attachmentId: string;
  mediaType: HarnessImageMediaType;
  bytes: number;
  width: number;
  height: number;
};
type HarnessImageBlock = {
  type: 'image';
  attachment: HarnessImageAttachmentRef;
};
type HarnessMessageBlock = HarnessTextBlock | HarnessImageBlock | { type: string };
type HarnessStreamChunk = {
  type: string;
  text?: string;
  block?: { type: string };
};

type HarnessTurnEndReason =
  | { kind: 'completed' | 'max-tokens' | 'aborted' | 'interrupted' | 'blocked' }
  | { kind: 'error'; error: { message: string } };

type HarnessSessionEvent = {
  type: string;
  data: {
    turn?: number | null;
    reason?: HarnessTurnEndReason;
    chunk?: HarnessStreamChunk;
    message?: { content: HarnessMessageBlock[] };
    agentPreset?: string;
    compactionId?: string;
    error?: string;
  };
};

const LODY_CAPABILITIES = {
  compaction: { version: 1 },
} as const satisfies LodyExtensionCapabilities;

type HarnessSession = {
  id: string;
  header: { id: string };
  events: readonly HarnessSessionEvent[];
  append(type: 'agent-preset/selected', data: { agentPreset: string }): void;
};

type HarnessAgent = {
  id: string;
  ctx: HarnessAgentContext;
  session: HarnessSession;
  followup(message: HarnessUserMessage): void;
  cancel(cause: { kind: 'user' }): void;
  whenIdle(): Promise<void>;
};

type HarnessUserMessage = {
  id: string;
  role: 'user';
  content: Array<HarnessTextBlock | HarnessImageBlock>;
  source: { kind: 'user' };
};

type HarnessAttachmentStore = {
  imageLimits: { mediaTypes: readonly string[] };
  saveImages(
    images: readonly { data: Uint8Array; mediaType: HarnessImageMediaType }[]
  ): Promise<readonly HarnessImageAttachmentRef[]>;
  readImage(ref: HarnessImageAttachmentRef): Promise<{
    data: Uint8Array;
    ref: HarnessImageAttachmentRef;
  }>;
};

type HarnessCatalogModel = {
  provider: string;
  id: string;
  name?: string;
  description?: string;
  inputModalities?: readonly string[];
};

type HarnessReasoningEffort = {
  id: string;
  name: string;
  description?: string;
};

type HarnessResolvedModel = Omit<HarnessCatalogModel, 'name'> & {
  name: string;
  reasoning?: {
    efforts: readonly HarnessReasoningEffort[];
    defaultEffort?: string;
  };
};

type HarnessLlmCatalog = {
  listModels(provider: string): Promise<readonly HarnessCatalogModel[]>;
  resolveModelInfo(
    provider: string,
    model: string,
    signal?: AbortSignal
  ): Promise<HarnessResolvedModel>;
};

type HarnessPermissionOption = {
  value: string;
  name: string;
  description?: string;
};

type HarnessAgentContext = {
  on<TArgs extends unknown[]>(event: string, listener: (...args: TArgs) => unknown): () => void;
  plugin(plugin: HarnessPlugin, config: HarnessMcpClientConfig): HarnessPluginHandle;
  loader: {
    import(name: string): Promise<unknown>;
    unwrapExports(exports: unknown): unknown;
  };
};

type HarnessPlugin = {
  apply(context: unknown, config: HarnessMcpClientConfig): unknown;
};

type HarnessPluginHandle = {
  await(): Promise<unknown>;
};

type HarnessMcpClientConfig =
  | {
      transport: 'stdio';
      serverName: string;
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd: string;
      toolCallTimeoutMs: number;
      failOnStartupError: boolean;
    }
  | {
      transport: 'streamable-http';
      serverName: string;
      url: string;
      headers: Record<string, string>;
      toolCallTimeoutMs: number;
      failOnStartupError: boolean;
    };

type HarnessAgentHandle = {
  agent: HarnessAgent;
  dispose(): Promise<void>;
};

type HarnessAgentPreset = {
  id: string;
  name?: string;
  description?: string;
  broken?: string;
};

type HarnessContext = {
  agents: {
    create(options: {
      sessionId: string;
      meta: { cwd: string; agentPreset: string };
      agentOptions: { provider: string; model: string };
      setup(agentContext: HarnessAgentContext): void | Promise<void>;
    }): Promise<HarnessAgentHandle>;
    get(sessionId: string): HarnessAgent | undefined;
  };
  permissionPresets: {
    names: readonly string[];
    defaultPreset: string;
    current(events: readonly HarnessSessionEvent[]): string;
    optionOf(name: string): HarnessPermissionOption;
    set(session: HarnessSession, name: string): void;
  };
  agentPresets: {
    defaultId: string;
    list(): Promise<HarnessAgentPreset[]>;
    mount(agentContext: HarnessAgentContext, id?: string): Promise<HarnessAgentPreset>;
    recompose(agentContext: HarnessAgentContext, id: string): Promise<HarnessAgentPreset>;
  };
  logger: {
    warn(message: string): void;
  };
  on<TArgs extends unknown[]>(event: string, listener: (...args: TArgs) => unknown): () => void;
  get(name: string): unknown;
  effect(register: () => () => Promise<void>, label: string): void;
};

export type DeepSeekAcpAdapterConfig = {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  /** Runtime-only transport override used by unit tests. */
  stream?: Stream;
};

type ResolvedAdapterConfig = {
  provider: string;
  model: string;
  reasoningEffort?: string;
  stream?: Stream;
};

type InflightPrompt = {
  resolve(reason: StopReason): void;
  reject(error: Error): void;
  messageId?: string;
  messageQueued: boolean;
  turn?: number;
  endReason?: HarnessTurnEndReason;
  admissionDone: Promise<void>;
  admissionController: AbortController;
  cancelRequested: boolean;
  settlementStarted: boolean;
  outputError?: Error;
  agentError?: Error;
};

type SessionRecord = {
  agent: HarnessAgent;
  dispose(): Promise<void>;
  selection: ModelSelectionRef;
  permissionMode: string;
  permissionOptions: HarnessPermissionOption[];
  agentPreset: string;
  agentPresetOptions: HarnessAgentPreset[];
  models: HarnessResolvedModel[];
  started: boolean;
  outputTail: Promise<void>;
  permissionSyncQueued?: boolean;
  inflight?: InflightPrompt;
};

type NewSessionResponseWithModels = NewSessionResponse & {
  models: {
    currentModelId: string;
    availableModels: Array<{
      modelId: string;
      name: string;
      description: string | null;
    }>;
  };
};

type ContinuableDrain = {
  drainContinuableDescendants(parents: readonly HarnessAgent[]): Promise<void>;
};

const MODEL_CONFIG_ID = 'model';
const MODE_CONFIG_ID = 'mode';
const REASONING_EFFORT_CONFIG_ID = 'reasoning_effort';
const AGENT_PRESET_CONFIG_ID = 'agent_preset';
const PERMISSION_EVENT_TYPES = new Set(['permission/preset', 'sandbox/mode', 'approval/policy']);
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client';
const MCP_TOOL_CALL_TIMEOUT_MS = 60_000;
const MCP_SERVER_NAME_MAX_LENGTH = 32;
const MCP_SERVER_NAME_HASH_LENGTH = 8;
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const MODEL_DISCOVERY_MAX_BYTES = 1024 * 1024;
const MODEL_DISCOVERY_MAX_MODELS = 1_000;
const MODEL_ID_MAX_LENGTH = 512;
const INVALID_MCP_SERVER_NAME_CHARS = /[^A-Za-z0-9_-]/gu;
const IMAGE_MEDIA_TYPES: readonly HarnessImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const IMAGE_ADMISSION_ERROR_CODES = new Set([
  'TOO_MANY_IMAGES',
  'IMAGES_TOO_LARGE',
  'UNSUPPORTED_IMAGE_TYPE',
  'INVALID_IMAGE_BASE64',
  'INVALID_IMAGE',
  'IMAGE_TYPE_MISMATCH',
  'IMAGE_TOO_LARGE',
  'IMAGE_TOO_MANY_PIXELS',
  'IMAGE_DIMENSION_TOO_LARGE',
]);

function invalidParams(detail: string): RequestError {
  return RequestError.invalidParams(undefined, detail);
}

function internalError(detail: string): RequestError {
  return RequestError.internalError(undefined, detail);
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function resolveAdapterConfig(config: DeepSeekAcpAdapterConfig | undefined): ResolvedAdapterConfig {
  const provider = nonEmptyString(config?.provider, 'deepseek-official');
  const model = nonEmptyString(config?.model, 'deepseek-v4-pro');
  return {
    provider,
    model,
    ...(config?.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
    ...(config?.stream ? { stream: config.stream } : {}),
  };
}

async function loadHarnessModels(
  llm: HarnessLlmCatalog,
  provider: string,
  configuredModel: string,
  endpoint?: { baseUrl: string; apiKey?: string }
): Promise<{ models: HarnessResolvedModel[]; initialModel: string }> {
  const listed = endpoint
    ? (await discoverDeepSeekModelIds(endpoint.baseUrl, endpoint.apiKey)).map((id) => ({
        provider,
        id,
      }))
    : await llm.listModels(provider);
  const modelIds: string[] = [];
  const ids = new Set<string>();
  for (const model of listed) {
    if (model.provider !== provider || !model.id.trim()) continue;
    if (ids.has(model.id)) {
      throw new Error(
        `acp-extension-dsh: duplicate model ${JSON.stringify(model.id)} for provider ${JSON.stringify(provider)}`
      );
    }
    ids.add(model.id);
    modelIds.push(model.id);
  }
  if (endpoint && modelIds.length === 0) {
    throw new Error('the endpoint returned no usable models');
  }
  // Without endpoint discovery, the Harness catalog remains advisory. An
  // explicitly configured route may name an unlisted model.
  if (!endpoint && !ids.has(configuredModel)) modelIds.unshift(configuredModel);
  const initialModel = endpoint ? modelIds[0]! : configuredModel;
  return {
    models: await Promise.all(
      modelIds.map((modelId) => resolveHarnessModel(llm, provider, modelId))
    ),
    initialModel,
  };
}

function modelDiscoveryUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/models`;
  url.hash = '';
  return url;
}

async function readLimitedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MODEL_DISCOVERY_MAX_BYTES) {
    throw new Error('model discovery response is too large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MODEL_DISCOVERY_MAX_BYTES) {
      await reader.cancel();
      throw new Error('model discovery response is too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function discoverDeepSeekModelIds(baseUrl: string, apiKey?: string): Promise<string[]> {
  const headers = new Headers({ accept: 'application/json' });
  if (apiKey) headers.set('authorization', `Bearer ${apiKey}`);
  let response: Response;
  try {
    response = await fetch(modelDiscoveryUrl(baseUrl), {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    throw new Error(`unable to request the endpoint model list: ${errorChain(error)}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new Error(`model discovery failed with HTTP ${response.status}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(await readLimitedResponse(response));
  } catch (error: unknown) {
    throw new Error(`model discovery returned invalid JSON: ${errorChain(error)}`, {
      cause: error,
    });
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('data' in body) ||
    !Array.isArray(body.data) ||
    body.data.length > MODEL_DISCOVERY_MAX_MODELS
  ) {
    throw new Error('model discovery returned an invalid OpenAI-compatible response');
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of body.data) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id || id.length > MODEL_ID_MAX_LENGTH || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

async function resolveHarnessModel(
  llm: HarnessLlmCatalog,
  provider: string,
  modelId: string,
  signal?: AbortSignal
): Promise<HarnessResolvedModel> {
  if (!modelId.trim()) throw invalidParams('model id must not be empty');
  const model = await llm.resolveModelInfo(provider, modelId, signal);
  if (model.provider !== provider || model.id !== modelId || !model.name?.trim()) {
    throw new Error(
      `acp-extension-dsh: invalid exact model metadata for ${JSON.stringify(provider)} / ${JSON.stringify(modelId)}`
    );
  }
  return model;
}

async function loadMcpClientPlugin(agentContext: HarnessAgentContext): Promise<HarnessPlugin> {
  const module = agentContext.loader.unwrapExports(
    await agentContext.loader.import(MCP_CLIENT_PACKAGE)
  );
  if (
    typeof module !== 'object' ||
    module === null ||
    !('apply' in module) ||
    typeof module.apply !== 'function'
  ) {
    throw new Error(`${MCP_CLIENT_PACKAGE} does not export a Cordis plugin`);
  }
  return module as HarnessPlugin;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, MCP_SERVER_NAME_HASH_LENGTH);
}

function normalizedMcpServerName(serverName: string, fallbackIndex: number): string {
  const normalized = serverName.replace(INVALID_MCP_SERVER_NAME_CHARS, '_');
  const base = normalized || `server_${fallbackIndex + 1}`;
  if (base === serverName && base.length <= MCP_SERVER_NAME_MAX_LENGTH) return base;
  const hash = shortHash(serverName);
  return `${base.slice(0, MCP_SERVER_NAME_MAX_LENGTH - hash.length - 1)}_${hash}`;
}

function reserveMcpServerNames(
  servers: readonly McpServer[],
  sessionId: string,
  activeNames: Set<string>
): { names: string[]; release(): void } {
  const names: string[] = [];
  for (const [index, server] of servers.entries()) {
    const base = normalizedMcpServerName(server.name, index);
    let reservedName = base;
    let attempt = 0;
    while (activeNames.has(reservedName)) {
      const suffix = shortHash(`${sessionId}\0${index}\0${attempt}`);
      reservedName = `${base.slice(0, MCP_SERVER_NAME_MAX_LENGTH - suffix.length - 1)}_${suffix}`;
      attempt += 1;
    }
    activeNames.add(reservedName);
    names.push(reservedName);
  }

  let released = false;
  return {
    names,
    release() {
      if (released) return;
      released = true;
      for (const reservedName of names) activeNames.delete(reservedName);
    },
  };
}

function entriesToRecord(
  entries: readonly { name: string; value: string }[]
): Record<string, string> {
  return Object.fromEntries(entries.map(({ name: entryName, value }) => [entryName, value]));
}

function mcpClientConfig(
  server: McpServer,
  serverName: string,
  cwd: string
): HarnessMcpClientConfig {
  if (!('type' in server)) {
    return {
      transport: 'stdio',
      serverName,
      command: server.command,
      args: [...server.args],
      env: entriesToRecord(server.env),
      cwd,
      toolCallTimeoutMs: MCP_TOOL_CALL_TIMEOUT_MS,
      failOnStartupError: true,
    };
  }
  if (server.type === 'http') {
    return {
      transport: 'streamable-http',
      serverName,
      url: server.url,
      headers: entriesToRecord(server.headers),
      toolCallTimeoutMs: MCP_TOOL_CALL_TIMEOUT_MS,
      failOnStartupError: true,
    };
  }
  throw invalidParams(`MCP transport ${server.type} is not supported`);
}

async function mountMcpServers(
  agentContext: HarnessAgentContext,
  servers: readonly McpServer[],
  serverNames: readonly string[],
  cwd: string
): Promise<void> {
  if (servers.length === 0) return;
  const plugin = await loadMcpClientPlugin(agentContext);
  const handles = servers.map((server, index) => {
    const serverName = serverNames[index];
    if (!serverName) throw new Error(`missing MCP namespace for server ${index}`);
    return agentContext.plugin(plugin, mcpClientConfig(server, serverName, cwd));
  });
  await Promise.all(handles.map((handle) => handle.await()));
}

function installModelSelection(
  agentContext: HarnessAgentContext,
  selection: ModelSelectionRef
): void {
  agentContext.on(
    'system-prompt/assemble',
    async (_assembly: unknown, _context: unknown, next: () => Promise<HarnessPromptAssembly>) => {
      const selected = { ...selection.current };
      const assembled = await next();
      selection.assembled = selected;
      return {
        ...assembled,
        variables: {
          ...assembled.variables,
          provider: selected.provider,
          model: selected.model,
        },
      };
    }
  );
  agentContext.on(
    'agent/request',
    async (_payload: unknown, next: () => Promise<HarnessRequestConfig>) => {
      const resolved = await next();
      const selected = selection.assembled ?? selection.current;
      const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved;
      return {
        ...withoutInheritedEffort,
        provider: selected.provider,
        model: selected.model,
        ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}),
      };
    }
  );
}

function configOptions(record: SessionRecord): SessionConfigOption[] {
  const options: SessionConfigOption[] = [
    {
      id: MODE_CONFIG_ID,
      name: 'Permission',
      description: 'Sandbox and approval policy for the session',
      category: 'mode',
      type: 'select',
      currentValue: record.permissionMode,
      options: record.permissionOptions.map((mode) => ({
        value: mode.value,
        name: mode.name,
        description: mode.description ?? null,
      })),
    },
    {
      id: AGENT_PRESET_CONFIG_ID,
      name: 'Agent preset',
      description: 'Tools, prompt, and capabilities composed for the session',
      category: 'agent_preset',
      type: 'select',
      currentValue: record.agentPreset,
      options: record.agentPresetOptions.map((preset) => {
        const builtIn = DEEPSEEK_HARNESS_AGENT_PRESETS.find(
          (candidate) => candidate.value === preset.id
        );
        // The pinned Harness presets may carry upstream-localized metadata.
        // Keep built-in ACP labels stable; runtime metadata still owns user presets.
        return {
          value: preset.id,
          name: builtIn?.name ?? preset.name ?? preset.id,
          description: builtIn?.description ?? preset.description ?? null,
        };
      }),
    },
    {
      id: MODEL_CONFIG_ID,
      name: 'Model',
      description: 'DeepSeek model used for the session',
      category: 'model',
      type: 'select',
      currentValue: record.selection.current.model,
      options: record.models.map((model) => ({
        value: model.id,
        name: model.name,
        description: model.description ?? null,
      })),
    },
  ];
  const model = record.models.find((candidate) => candidate.id === record.selection.current.model);
  if (model?.reasoning && record.selection.current.reasoningEffort) {
    options.push({
      id: REASONING_EFFORT_CONFIG_ID,
      name: 'Reasoning effort',
      description: 'How much reasoning effort the model should use',
      category: 'thought_level',
      type: 'select',
      currentValue: record.selection.current.reasoningEffort,
      options: model.reasoning.efforts.map((effort) => ({
        value: effort.id,
        name: effort.name,
        description: effort.description ?? null,
      })),
    });
  }
  return options;
}

function legacyModels(record: SessionRecord): NewSessionResponseWithModels['models'] {
  return {
    currentModelId: record.selection.current.model,
    availableModels: record.models.flatMap((model) => [
      {
        modelId: model.id,
        name: model.name,
        description: model.description ?? null,
      },
      ...(model.reasoning?.efforts.map((effort) => ({
        modelId: `${model.id}[${effort.id}]`,
        name: `${model.name} (${effort.name})`,
        description: model.description ?? null,
      })) ?? []),
    ]),
  };
}

function modeState(record: SessionRecord): SessionModeState {
  return {
    currentModeId: record.permissionMode,
    availableModes: record.permissionOptions.map((mode) => ({
      id: mode.value,
      name: mode.name,
      description: mode.description ?? null,
    })),
  };
}

function supportsAcpImagePrompts(
  attachments: HarnessAttachmentStore | undefined,
  models: readonly HarnessResolvedModel[]
): boolean {
  return (
    attachments !== undefined &&
    attachments.imageLimits.mediaTypes.some((mediaType) =>
      IMAGE_MEDIA_TYPES.includes(mediaType as HarnessImageMediaType)
    ) &&
    models.some((model) => model.inputModalities?.includes('image'))
  );
}

function resolveReasoningEffort(
  model: HarnessResolvedModel,
  requested: string | undefined
): string | undefined {
  const reasoning = model.reasoning;
  if (!reasoning) {
    if (requested) {
      throw invalidParams(
        `model ${JSON.stringify(model.id)} does not support reasoning effort ${JSON.stringify(requested)}`
      );
    }
    return undefined;
  }
  const effort = requested ?? reasoning.defaultEffort;
  if (!effort) return undefined;
  assertAllowed(
    effort,
    new Set(reasoning.efforts.map((candidate) => candidate.id)),
    `reasoning effort for model ${model.id}`
  );
  return effort;
}

function permissionState(ctx: HarnessContext, currentMode: string): HarnessPermissionOption[] {
  const options = ctx.permissionPresets.names.map((mode) => ctx.permissionPresets.optionOf(mode));
  if (!ctx.permissionPresets.names.includes(currentMode)) {
    options.push(ctx.permissionPresets.optionOf(currentMode));
  }
  return options;
}

function imageMediaType(value: string): HarnessImageMediaType | undefined {
  return IMAGE_MEDIA_TYPES.includes(value as HarnessImageMediaType)
    ? (value as HarnessImageMediaType)
    : undefined;
}

function decodePromptImage(block: Extract<PromptRequest['prompt'][number], { type: 'image' }>): {
  data: Uint8Array;
  mediaType: HarnessImageMediaType;
} {
  const mediaType = imageMediaType(block.mimeType);
  if (!mediaType) {
    throw invalidParams('image mimeType must be image/png, image/jpeg, image/webp, or image/gif');
  }
  if (!block.data || !CANONICAL_BASE64.test(block.data)) {
    throw invalidParams('image data must be canonical base64');
  }
  const decoded = Buffer.from(block.data, 'base64');
  if (decoded.toString('base64') !== block.data) {
    throw invalidParams('image data must be canonical base64');
  }
  return { data: new Uint8Array(decoded), mediaType };
}

function isImageAdmissionError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    IMAGE_ADMISSION_ERROR_CODES.has(error.code)
  );
}

async function admitAcpPrompt(
  prompt: PromptRequest['prompt'],
  llm: HarnessLlmCatalog,
  selection: ModelSelection,
  attachments: HarnessAttachmentStore | undefined,
  imagePromptEnabled: boolean,
  signal: AbortSignal
): Promise<Array<HarnessTextBlock | HarnessImageBlock>> {
  const images: Array<{ data: Uint8Array; mediaType: HarnessImageMediaType }> = [];
  for (const block of prompt) {
    switch (block.type) {
      case 'text':
      case 'resource_link':
        break;
      case 'image':
        if (!imagePromptEnabled) {
          throw invalidParams('inline image prompts were not advertised by this connection');
        }
        images.push(decodePromptImage(block));
        break;
      case 'audio':
        throw invalidParams('audio prompt content is not supported');
      case 'resource':
        throw invalidParams('embedded resource prompt content is not supported');
      default:
        throw invalidParams('unsupported ACP prompt content');
    }
  }

  let refs: readonly HarnessImageAttachmentRef[] = [];
  if (images.length > 0) {
    if (!attachments) throw internalError('no Harness attachment store is mounted');
    signal.throwIfAborted();
    let model: HarnessResolvedModel;
    try {
      model = await resolveHarnessModel(llm, selection.provider, selection.model, signal);
    } catch (error: unknown) {
      throw internalError(`unable to verify the current image model: ${errorChain(error)}`);
    }
    if (!model.inputModalities?.includes('image')) {
      throw invalidParams(`model ${JSON.stringify(selection.model)} does not support image input`);
    }
    signal.throwIfAborted();
    try {
      refs = await attachments.saveImages(images);
    } catch (error: unknown) {
      if (isImageAdmissionError(error)) throw invalidParams(error.message);
      throw internalError('unable to persist the prompt image batch');
    }
    signal.throwIfAborted();
  }

  const content: Array<HarnessTextBlock | HarnessImageBlock> = [];
  let pendingText = '';
  let imageIndex = 0;
  const flushText = (): void => {
    if (!pendingText) return;
    content.push({ type: 'text', text: pendingText });
    pendingText = '';
  };
  for (const block of prompt) {
    if (block.type === 'text') {
      pendingText += block.text;
    } else if (block.type === 'resource_link') {
      pendingText += `\n[resource_link name=${JSON.stringify(block.name)} uri=${JSON.stringify(block.uri)}]\n`;
    } else if (block.type === 'image') {
      flushText();
      const attachment = refs[imageIndex++];
      if (!attachment)
        throw internalError('the attachment store returned an incomplete image batch');
      content.push({ type: 'image', attachment });
    }
  }
  flushText();
  if (
    !content.some(
      (block) => block.type === 'image' || (block.type === 'text' && block.text.trim().length > 0)
    )
  ) {
    throw invalidParams('empty prompt');
  }
  return content;
}

async function assistantBlockToAcp(
  block: HarnessMessageBlock,
  attachments: HarnessAttachmentStore | undefined
): Promise<ContentBlock | undefined> {
  if (block.type === 'text' && 'text' in block) {
    return block.text.length > 0 ? { type: 'text', text: block.text } : undefined;
  }
  if (block.type !== 'image' || !('attachment' in block)) return undefined;
  if (!attachments)
    throw new Error('cannot deliver assistant image: no attachment store is mounted');
  let stored: Awaited<ReturnType<HarnessAttachmentStore['readImage']>>;
  try {
    stored = await attachments.readImage(block.attachment);
  } catch (error: unknown) {
    throw new Error('cannot deliver assistant image: the attachment is unavailable or corrupt', {
      cause: error,
    });
  }
  return {
    type: 'image',
    data: Buffer.from(stored.data).toString('base64'),
    mimeType: stored.ref.mediaType,
  };
}

function createUserMessage(
  id: string,
  content: Array<HarnessTextBlock | HarnessImageBlock>
): HarnessUserMessage {
  return Object.freeze({
    id,
    role: 'user' as const,
    content: Object.freeze(content.map((block) => Object.freeze(block))),
    source: Object.freeze({ kind: 'user' as const }),
  }) as HarnessUserMessage;
}

function errorChain(value: unknown): string {
  const seen = new Set<unknown>();
  const render = (current: unknown): string => {
    if (seen.has(current)) return '<circular cause>';
    seen.add(current);
    try {
      if (!(current instanceof Error)) return String(current);
      const message = current.message || current.name;
      const cause = current.cause == null ? '' : render(current.cause);
      return cause && cause !== message ? `${message}: ${cause}` : message;
    } finally {
      seen.delete(current);
    }
  };
  return render(value);
}

function validateSessionParams(params: NewSessionRequest): void {
  if (!isAbsolute(params.cwd)) {
    throw invalidParams(`cwd must be an absolute path: ${params.cwd}`);
  }
  if (params.additionalDirectories && params.additionalDirectories.length > 0) {
    throw invalidParams('additionalDirectories is not supported');
  }
  for (const server of params.mcpServers) {
    if ('type' in server && server.type !== 'http') {
      throw invalidParams(`MCP transport ${server.type} is not supported`);
    }
  }
}

function requireSelectValue(params: SetSessionConfigOptionRequest): string {
  if (typeof params.value !== 'string') {
    throw invalidParams(`${params.configId} requires a select value`);
  }
  return params.value;
}

function assertAllowed(value: string, allowed: ReadonlySet<string>, label: string): void {
  if (!allowed.has(value)) {
    throw invalidParams(`unknown ${label}: ${value} (available: ${[...allowed].join(', ')})`);
  }
}

/** Mount the ACP bridge into the surrounding Harness composition. */
export function apply(ctx: HarnessContext, rawConfig?: DeepSeekAcpAdapterConfig): void {
  const config = resolveAdapterConfig(rawConfig);
  const sessions = new Map<string, SessionRecord>();
  const activeMcpServerNames = new Set<string>();
  let closed = false;
  let conn: AgentSideConnection;
  let imagePromptEnabled = false;

  if (ctx.permissionPresets.names.length === 0) {
    throw new Error('acp-extension-dsh: no permission presets are composed');
  }
  const llm = ctx.get('llm') as HarnessLlmCatalog | undefined;
  if (!llm) throw new Error('acp-extension-dsh: no Harness LLM catalog is mounted');
  const attachments = ctx.get('attachments') as HarnessAttachmentStore | undefined;
  const baseUrl = process.env[DEEPSEEK_HARNESS_BASE_URL_ENV]?.trim();
  const apiKey = process.env[DEEPSEEK_HARNESS_API_KEY_ENV]?.trim();
  let modelCatalog: Promise<{ models: HarnessResolvedModel[]; initialModel: string }> | undefined;
  const loadModelCatalog = () =>
    (modelCatalog ??= loadHarnessModels(
      llm,
      config.provider,
      config.model,
      baseUrl ? { baseUrl, ...(apiKey ? { apiKey } : {}) } : undefined
    ));

  const assertOpen = (): void => {
    if (closed) throw internalError('the ACP bridge has been disposed');
  };

  const requireSession = (sessionId: string): SessionRecord => {
    const record = sessions.get(sessionId);
    if (!record) throw invalidParams(`unknown session: ${sessionId}`);
    return record;
  };

  const ownedRecord = (agent: HarnessAgent): SessionRecord | undefined => {
    const record = sessions.get(agent.session.id);
    return record?.agent === agent ? record : undefined;
  };

  const notify = async (notification: SessionNotification): Promise<void> => {
    await conn.sessionUpdate(notification).catch((error: unknown) => {
      ctx.logger.warn(`acp-extension-dsh: session/update failed: ${String(error)}`);
    });
  };

  const enqueueOutput = (
    record: SessionRecord,
    work: () => Promise<void>,
    inflight?: InflightPrompt
  ): void => {
    record.outputTail = record.outputTail.then(work).catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (inflight) inflight.outputError ??= failure;
      ctx.logger.warn(`acp-extension-dsh: assistant output failed: ${errorChain(error)}`);
    });
  };

  const enqueueNotification = (
    record: SessionRecord,
    notification: SessionNotification,
    inflight?: InflightPrompt
  ): void => enqueueOutput(record, () => notify(notification), inflight);

  const settleAfterQuiescence = (record: SessionRecord, inflight: InflightPrompt): void => {
    if (inflight.settlementStarted) return;
    inflight.settlementStarted = true;
    void (async () => {
      await inflight.admissionDone;
      if (inflight.messageQueued) {
        await record.agent.whenIdle();
        await record.outputTail;
      }
      if (record.inflight !== inflight) return;
      record.inflight = undefined;
      if (inflight.cancelRequested) {
        inflight.resolve('cancelled');
      } else if (inflight.outputError) {
        inflight.reject(
          internalError(`assistant output delivery failed: ${inflight.outputError.message}`)
        );
      } else if (inflight.agentError) {
        inflight.reject(internalError(`turn failed: ${inflight.agentError.message}`));
      } else if (inflight.endReason?.kind === 'error') {
        inflight.reject(internalError(`turn failed: ${inflight.endReason.error.message}`));
      } else {
        const end = inflight.endReason;
        inflight.resolve(
          end ? (end.kind === 'interrupted' ? 'cancelled' : 'end_turn') : 'cancelled'
        );
      }
    })().catch((error: unknown) => {
      if (record.inflight !== inflight) return;
      record.inflight = undefined;
      inflight.reject(internalError(`prompt settlement failed: ${errorChain(error)}`));
    });
  };

  const refreshPermissionState = (record: SessionRecord): boolean => {
    const permissionMode = ctx.permissionPresets.current(record.agent.session.events);
    if (permissionMode === record.permissionMode) return false;
    record.permissionMode = permissionMode;
    record.permissionOptions = permissionState(ctx, permissionMode);
    return true;
  };

  const schedulePermissionSync = (record: SessionRecord): void => {
    if (record.permissionSyncQueued) return;
    record.permissionSyncQueued = true;
    queueMicrotask(() => {
      record.permissionSyncQueued = false;
      if (sessions.get(record.agent.session.id) !== record) return;
      try {
        if (!refreshPermissionState(record)) return;
        enqueueNotification(record, {
          sessionId: record.agent.session.id,
          update: {
            sessionUpdate: 'current_mode_update',
            currentModeId: record.permissionMode,
          },
        });
        enqueueNotification(record, {
          sessionId: record.agent.session.id,
          update: {
            sessionUpdate: 'config_option_update',
            configOptions: configOptions(record),
          },
        });
      } catch (error: unknown) {
        ctx.logger.warn(
          `acp-extension-dsh: failed to synchronize permission state: ${errorChain(error)}`
        );
      }
    });
  };

  const disposeRecords = async (records: readonly SessionRecord[]): Promise<void> => {
    await Promise.all(
      records.map(async (record) => {
        await record.inflight?.admissionDone;
        await record.agent.whenIdle();
        await record.outputTail;
      })
    );
    const subagents = ctx.get('subagents') as ContinuableDrain | undefined;
    if (subagents) {
      try {
        await subagents.drainContinuableDescendants(records.map((record) => record.agent));
      } catch (error: unknown) {
        ctx.logger.warn(
          `acp-extension-dsh: continuable subagent teardown failed: ${String(error)}`
        );
      }
    }
    const results = await Promise.allSettled(records.map((record) => record.dispose()));
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason as unknown);
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `DeepSeek ACP teardown failed for ${failures.length} session(s): ${failures
          .map(errorChain)
          .join('; ')}`
      );
    }
  };

  ctx.on('session/event', (session: HarnessSession, event: HarnessSessionEvent) => {
    const record = sessions.get(session.header.id);
    if (!record || record.agent.session !== session) return;
    if (PERMISSION_EVENT_TYPES.has(event.type)) schedulePermissionSync(record);
    try {
      if (
        event.type === 'assistant/chunk' &&
        event.data.chunk?.type === 'reasoning-delta' &&
        typeof event.data.chunk.text === 'string' &&
        event.data.chunk.text.length > 0
      ) {
        enqueueNotification(record, {
          sessionId: record.agent.session.id,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: event.data.chunk.text },
          },
        });
      } else if (
        event.type === 'assistant/chunk' &&
        event.data.chunk?.type === 'block-end' &&
        event.data.chunk.block?.type === 'reasoning'
      ) {
        enqueueNotification(record, {
          sessionId: record.agent.session.id,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: '\n\n' },
          },
        });
      } else if (event.type === 'assistant/message') {
        const inflight = record.inflight?.turn === event.data.turn ? record.inflight : undefined;
        enqueueOutput(
          record,
          async () => {
            for (const block of event.data.message?.content ?? []) {
              const content = await assistantBlockToAcp(block, attachments);
              if (!content) continue;
              await notify({
                sessionId: record.agent.session.id,
                update: { sessionUpdate: 'agent_message_chunk', content },
              });
            }
          },
          inflight
        );
      } else if (event.type === 'compaction/start' && event.data.compactionId) {
        const activity = {
          version: 1,
          kind: 'context_compaction',
          automatic: event.data.turn !== null,
        } as const satisfies LodyActivityMeta;
        enqueueNotification(record, {
          sessionId: record.agent.session.id,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: `context-compaction:${event.data.compactionId}`,
            title: 'Compacting context',
            kind: 'think',
            status: 'in_progress',
            _meta: { lody: { activity } },
          },
        });
      } else if (event.type === 'compaction/end' && event.data.compactionId) {
        const activity = {
          version: 1,
          kind: 'context_compaction',
          automatic: event.data.turn !== null,
          ...(event.data.error ? { failureReason: event.data.error } : {}),
        } as const satisfies LodyActivityMeta;
        enqueueNotification(record, {
          sessionId: record.agent.session.id,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: `context-compaction:${event.data.compactionId}`,
            title: event.data.error ? 'Context compaction failed' : 'Context compacted',
            status: event.data.error ? 'failed' : 'completed',
            _meta: { lody: { activity } },
          },
        });
      }
    } finally {
      const inflight = record.inflight;
      if (
        inflight &&
        event.type === 'turn/end' &&
        inflight.turn === event.data.turn &&
        event.data.reason
      ) {
        inflight.endReason = event.data.reason;
      }
    }
  });

  ctx.on(
    'agent/inbox/claimed',
    ({ agent, message, turn }: { agent: HarnessAgent; message: { id: string }; turn: number }) => {
      const inflight = ownedRecord(agent)?.inflight;
      if (inflight && inflight.messageId === message.id) inflight.turn = turn;
    }
  );

  ctx.on(
    'agent/error',
    ({ agent, turn, error }: { agent: HarnessAgent; turn: number; error: unknown }) => {
      const record = ownedRecord(agent);
      const inflight = record?.inflight;
      if (!record || !inflight || !inflight.messageQueued || inflight.turn !== turn) return;
      inflight.agentError = new Error(errorChain(error));
      settleAfterQuiescence(record, inflight);
    }
  );

  ctx.on(
    'approval/request',
    (
      request: { agent: HarnessAgent; callId?: string },
      next: () => Promise<unknown>
    ): Promise<unknown> | undefined => {
      const record = ownedRecord(request.agent);
      if (!record || !request.callId) return next();
      return conn
        .requestPermission({
          sessionId: record.agent.session.id,
          toolCall: { toolCallId: request.callId },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
        })
        .then(({ outcome }) => {
          if (outcome.outcome === 'cancelled') return 'cancelled';
          return outcome.optionId === 'allow-once' ? 'allowed-once' : 'rejected';
        });
    }
  );

  const setPermissionMode = (record: SessionRecord, modeId: string): void => {
    if (modeId === record.permissionMode) return;
    assertAllowed(modeId, new Set(ctx.permissionPresets.names), 'permission mode');
    ctx.permissionPresets.set(record.agent.session, modeId);
    const permissionMode = ctx.permissionPresets.current(record.agent.session.events);
    if (permissionMode !== modeId) {
      throw internalError(
        `permission preset ${JSON.stringify(modeId)} did not become the effective mode`
      );
    }
    record.permissionMode = permissionMode;
    record.permissionOptions = permissionState(ctx, permissionMode);
  };

  const setConfigOption = (
    record: SessionRecord,
    params: SetSessionConfigOptionRequest
  ): SetSessionConfigOptionResponse | Promise<SetSessionConfigOptionResponse> => {
    const value = requireSelectValue(params);
    if (params.configId === MODE_CONFIG_ID) {
      setPermissionMode(record, value);
    } else if (params.configId === AGENT_PRESET_CONFIG_ID) {
      const available = new Set(record.agentPresetOptions.map((preset) => preset.id));
      assertAllowed(value, available, 'agent preset');
      if (value === record.agentPreset) return { configOptions: configOptions(record) };
      if (record.started) {
        throw invalidParams('agent preset is fixed after the session has started');
      }
      return ctx.agentPresets
        .recompose(record.agent.ctx, value)
        .then((preset) => {
          record.agent.session.append('agent-preset/selected', { agentPreset: preset.id });
          record.agentPreset = preset.id;
          return { configOptions: configOptions(record) };
        })
        .catch((error: unknown) => {
          if (error instanceof RequestError) throw error;
          throw invalidParams(
            `failed to select agent preset ${JSON.stringify(value)}: ${errorChain(error)}`
          );
        });
    } else if (params.configId === MODEL_CONFIG_ID) {
      return resolveHarnessModel(llm, record.selection.current.provider, value)
        .then((model) => {
          const index = record.models.findIndex((candidate) => candidate.id === value);
          if (index === -1) record.models.push(model);
          else record.models[index] = model;
          const reasoningEffort = resolveReasoningEffort(
            model,
            record.selection.current.reasoningEffort &&
              model.reasoning?.efforts.some(
                (effort) => effort.id === record.selection.current.reasoningEffort
              )
              ? record.selection.current.reasoningEffort
              : undefined
          );
          record.selection.current = {
            provider: record.selection.current.provider,
            model: value,
            ...(reasoningEffort ? { reasoningEffort } : {}),
          };
          return { configOptions: configOptions(record) };
        })
        .catch((error: unknown) => {
          if (error instanceof RequestError) throw error;
          throw invalidParams(
            `failed to resolve model ${JSON.stringify(value)}: ${errorChain(error)}`
          );
        });
    } else if (params.configId === REASONING_EFFORT_CONFIG_ID) {
      const model = record.models.find(
        (candidate) => candidate.id === record.selection.current.model
      );
      if (!model) throw internalError('selected model metadata is unavailable');
      const reasoningEffort = resolveReasoningEffort(model, value);
      if (!reasoningEffort) {
        throw invalidParams(`model ${JSON.stringify(model.id)} has no reasoning selector`);
      }
      record.selection.current = {
        ...record.selection.current,
        reasoningEffort,
      };
    } else {
      throw invalidParams(`unknown config option: ${params.configId}`);
    }
    return { configOptions: configOptions(record) };
  };

  const makeAgent = (connection: AgentSideConnection): AcpAgent => {
    conn = connection;
    return {
      async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
        const { models } = await loadModelCatalog();
        imagePromptEnabled = supportsAcpImagePrompts(attachments, models);
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: 'acp-extension-dsh', version: ACP_EXTENSION_DSH_VERSION },
          agentCapabilities: {
            promptCapabilities: {
              image: imagePromptEnabled,
              audio: false,
              embeddedContext: false,
            },
            mcpCapabilities: { http: true },
            sessionCapabilities: { close: {} },
            _meta: { lody: LODY_CAPABILITIES },
          },
          authMethods: [],
        };
      },

      authenticate(_params: AuthenticateRequest): Promise<void> {
        return Promise.resolve();
      },

      async newSession(params: NewSessionRequest): Promise<NewSessionResponseWithModels> {
        assertOpen();
        validateSessionParams(params);
        let catalog: { models: HarnessResolvedModel[]; initialModel: string };
        try {
          catalog = await loadModelCatalog();
        } catch (error: unknown) {
          throw internalError(`failed to discover models: ${errorChain(error)}`);
        }
        const { models, initialModel: initialModelId } = catalog;
        const sessionId = randomUUID();
        const initialModel = models.find((model) => model.id === initialModelId);
        if (!initialModel) throw internalError('initial model metadata is unavailable');
        const reasoningEffort = resolveReasoningEffort(initialModel, config.reasoningEffort);
        const selection: ModelSelectionRef = {
          current: {
            provider: config.provider,
            model: initialModelId,
            ...(reasoningEffort ? { reasoningEffort } : {}),
          },
        };
        const agentPresetOptions = (await ctx.agentPresets.list()).filter(
          (preset) => preset.broken === undefined
        );
        const requestedPreset = ctx.agentPresets.defaultId;
        if (!agentPresetOptions.some((preset) => preset.id === requestedPreset)) {
          throw internalError(
            `default agent preset ${JSON.stringify(requestedPreset)} is unavailable`
          );
        }
        const mcpServerNames = reserveMcpServerNames(
          params.mcpServers,
          sessionId,
          activeMcpServerNames
        );
        let mountedPreset = requestedPreset;
        let handle: HarnessAgentHandle;
        try {
          handle = await ctx.agents.create({
            sessionId,
            meta: { cwd: params.cwd, agentPreset: requestedPreset },
            agentOptions: { provider: config.provider, model: initialModelId },
            setup: async (agentContext) => {
              installModelSelection(agentContext, selection);
              mountedPreset = (await ctx.agentPresets.mount(agentContext, requestedPreset)).id;
              await mountMcpServers(
                agentContext,
                params.mcpServers,
                mcpServerNames.names,
                params.cwd
              );
            },
          });
        } catch (error: unknown) {
          mcpServerNames.release();
          if (error instanceof RequestError) throw error;
          throw internalError(`failed to create session: ${errorChain(error)}`);
        }
        const dispose = async (): Promise<void> => {
          try {
            await handle.dispose();
          } finally {
            mcpServerNames.release();
          }
        };
        if (closed) {
          await dispose();
          throw internalError('connection closed during session/new');
        }
        let permissionMode: string;
        let permissionOptions: HarnessPermissionOption[];
        try {
          permissionMode = ctx.permissionPresets.current(handle.agent.session.events);
          permissionOptions = permissionState(ctx, permissionMode);
        } catch (error: unknown) {
          await dispose();
          throw error;
        }
        const record: SessionRecord = {
          agent: handle.agent,
          dispose,
          selection,
          permissionMode,
          permissionOptions,
          agentPreset: mountedPreset,
          agentPresetOptions,
          models,
          started: false,
          outputTail: Promise.resolve(),
        };
        sessions.set(sessionId, record);
        return {
          sessionId,
          modes: modeState(record),
          configOptions: configOptions(record),
          models: legacyModels(record),
        };
      },

      setSessionMode(params: SetSessionModeRequest): void {
        const record = requireSession(params.sessionId);
        setPermissionMode(record, params.modeId);
      },

      setSessionConfigOption(
        params: SetSessionConfigOptionRequest
      ): SetSessionConfigOptionResponse | Promise<SetSessionConfigOptionResponse> {
        return setConfigOption(requireSession(params.sessionId), params);
      },

      async prompt(params: PromptRequest): Promise<PromptResponse> {
        assertOpen();
        const record = requireSession(params.sessionId);
        if (record.inflight) throw invalidParams('a prompt is already in flight for this session');
        if (ctx.agents.get(record.agent.id) !== record.agent) {
          throw internalError('prompt was not queued: the agent was disposed outside the bridge');
        }
        const messageId = randomUUID();
        let resolvePrompt!: (reason: StopReason) => void;
        let rejectPrompt!: (error: Error) => void;
        let finishAdmission!: () => void;
        const completion = new Promise<StopReason>((resolve, reject) => {
          resolvePrompt = resolve;
          rejectPrompt = reject;
        });
        const admissionDone = new Promise<void>((resolve) => {
          finishAdmission = resolve;
        });
        const admissionController = new AbortController();
        const inflight: InflightPrompt = {
          resolve: resolvePrompt,
          reject: rejectPrompt,
          messageQueued: false,
          admissionDone,
          admissionController,
          cancelRequested: false,
          settlementStarted: false,
        };
        record.inflight = inflight;
        let admissionError: unknown;
        try {
          const content = await admitAcpPrompt(
            params.prompt,
            llm,
            record.selection.current,
            attachments,
            imagePromptEnabled,
            admissionController.signal
          );
          if (!inflight.cancelRequested) {
            if (ctx.agents.get(record.agent.id) !== record.agent) {
              throw internalError(
                'prompt was not queued: the agent was disposed outside the bridge'
              );
            }
            const message = createUserMessage(messageId, content);
            inflight.messageId = messageId;
            inflight.messageQueued = true;
            const wasStarted = record.started;
            try {
              record.agent.followup(message);
              record.started = true;
            } catch (error: unknown) {
              inflight.messageQueued = false;
              record.started = wasStarted;
              throw new Error(
                `prompt was not queued: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error }
              );
            }
          }
        } catch (error: unknown) {
          admissionError = error;
        } finally {
          finishAdmission();
        }
        if (inflight.cancelRequested) {
          settleAfterQuiescence(record, inflight);
          return { stopReason: await completion };
        }
        if (admissionError) {
          if (record.inflight === inflight) record.inflight = undefined;
          if (admissionError instanceof RequestError) throw admissionError;
          throw internalError(errorChain(admissionError));
        }
        settleAfterQuiescence(record, inflight);
        return { stopReason: await completion };
      },

      cancel(params: CancelNotification): Promise<void> {
        const record = sessions.get(params.sessionId);
        if (!record) return Promise.resolve();
        const inflight = record.inflight;
        if (inflight) {
          inflight.cancelRequested = true;
          inflight.admissionController.abort(new Error('ACP prompt cancelled'));
          settleAfterQuiescence(record, inflight);
        }
        if (!inflight || inflight.messageQueued) record.agent.cancel({ kind: 'user' });
        return Promise.resolve();
      },

      async closeSession(params: CloseSessionRequest): Promise<void> {
        const record = requireSession(params.sessionId);
        sessions.delete(params.sessionId);
        const inflight = record.inflight;
        if (inflight) {
          inflight.cancelRequested = true;
          inflight.admissionController.abort(new Error('ACP session closed'));
          settleAfterQuiescence(record, inflight);
        }
        if (!inflight || inflight.messageQueued) record.agent.cancel({ kind: 'user' });
        await disposeRecords([record]);
      },
    };
  };

  const stream =
    config.stream ??
    ndJsonStream(
      Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
      Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>
    );
  conn = new AgentSideConnection(makeAgent, stream);

  let quiescing: Promise<void> | undefined;
  const quiesce = (): Promise<void> => {
    if (quiescing) return quiescing;
    closed = true;
    const records = [...sessions.values()];
    sessions.clear();
    for (const record of records) {
      const inflight = record.inflight;
      if (inflight) {
        inflight.cancelRequested = true;
        inflight.admissionController.abort(new Error('ACP bridge disposed'));
        settleAfterQuiescence(record, inflight);
      }
      if (!inflight || inflight.messageQueued) record.agent.cancel({ kind: 'user' });
    }
    quiescing = (async () => {
      await disposeRecords(records);
    })();
    return quiescing;
  };

  void conn.closed
    .catch((error: unknown) => {
      ctx.logger.warn(`acp-extension-dsh: connection closed with an error: ${String(error)}`);
    })
    .then(quiesce)
    .catch((error: unknown) => {
      ctx.logger.warn(`acp-extension-dsh: connection-close teardown failed: ${String(error)}`);
    });
  ctx.effect(() => quiesce, 'acp-extension-dsh.connection');
}
