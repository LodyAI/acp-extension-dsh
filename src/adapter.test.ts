import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type AnyMessage,
  type SessionConfigOption,
  type Stream,
} from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apply } from './adapter.js';
import { DEEPSEEK_HARNESS_AGENT_PRESETS, DEEPSEEK_HARNESS_MODELS } from './capabilities.js';

type Listener = (...args: unknown[]) => unknown;

const DEFAULT_LLM_CATALOG = {
  listModels: async (provider: string) =>
    DEEPSEEK_HARNESS_MODELS.map((model) => ({
      provider,
      id: model.modelId,
      name: model.name,
      description: model.description,
      inputModalities: model.inputModalities,
    })),
  resolveModelInfo: async (provider: string, modelId: string) => {
    const catalogModel = DEEPSEEK_HARNESS_MODELS.find((model) => model.modelId === modelId);
    return {
      provider,
      id: modelId,
      name: catalogModel?.name ?? modelId,
      description: catalogModel?.description,
      inputModalities: catalogModel?.inputModalities ?? ['text'],
      ...(modelId === 'no-reasoning'
        ? {}
        : {
            reasoning: {
              efforts: [
                { id: 'off', name: 'Off' },
                { id: 'low', name: 'Low' },
                { id: 'high', name: 'High' },
                { id: 'max', name: 'Max' },
              ],
              defaultEffort: 'max',
            },
          }),
    };
  },
};

const PERMISSION_OPTIONS = {
  'read-only': {
    value: 'read-only',
    name: 'Read-only',
    description: 'Read inside the workspace',
  },
  'workspace-write': {
    value: 'workspace-write',
    name: 'Workspace write',
    description: 'Read and write inside the workspace',
  },
  'danger-full-access': {
    value: 'danger-full-access',
    name: 'Full access',
    description: 'Unrestricted access',
  },
  reviewed: {
    value: 'reviewed',
    name: 'Reviewed writes',
    description: 'Use a deployment-defined review policy',
  },
  custom: {
    value: 'custom',
    name: 'Custom',
    description: 'Current sandbox and approval settings do not match a preset.',
  },
} as const;

function permissionOption(name: string) {
  const option = PERMISSION_OPTIONS[name as keyof typeof PERMISSION_OPTIONS];
  if (!option) throw new Error(`unknown permission option: ${name}`);
  return option;
}

function testHarnessService(name: string): unknown {
  return name === 'llm' ? DEFAULT_LLM_CATALOG : undefined;
}

function connectedStreams(): { agent: Stream; client: Stream } {
  const clientToAgent = new TransformStream<AnyMessage, AnyMessage>();
  const agentToClient = new TransformStream<AnyMessage, AnyMessage>();
  return {
    agent: {
      readable: clientToAgent.readable,
      writable: agentToClient.writable,
    },
    client: {
      readable: agentToClient.readable,
      writable: clientToAgent.writable,
    },
  };
}

function selectValue(options: SessionConfigOption[] | null | undefined, id: string): unknown {
  return options?.find((option) => option.id === id)?.currentValue;
}

function selectOption(options: SessionConfigOption[] | null | undefined, id: string) {
  return options?.find((option) => option.id === id);
}

describe('DeepSeek Harness ACP adapter', () => {
  const disposers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(disposers.splice(0).map((dispose) => dispose()));
  });

  it('applies model, reasoning-effort, and permission selections to Harness state', async () => {
    const streams = connectedStreams();
    const scopedListeners = new Map<string, Listener>();
    const harnessListeners = new Map<string, Listener>();
    const permissionSwitches: string[] = [];
    const agentPresetSwitches: string[] = [];
    const sessionUpdates: Array<{ sessionId: string; update: Record<string, unknown> }> = [];
    let currentPermission = 'workspace-write';
    let createdHarnessSession: unknown;

    const context: Parameters<typeof apply>[0] = {
      agents: {
        async create(options) {
          const agentContext: Parameters<typeof options.setup>[0] = {
            on<TArgs extends unknown[]>(
              event: string,
              listener: (...args: TArgs) => unknown
            ): () => void {
              scopedListeners.set(event, listener as Listener);
              return () => scopedListeners.delete(event);
            },
            plugin: () => ({ await: () => Promise.resolve() }),
            loader: {
              import: () => Promise.resolve({}),
              unwrapExports: (exports) => exports,
            },
          };
          await options.setup(agentContext);
          const session = {
            id: options.sessionId,
            header: { id: options.sessionId },
            events: [] as Array<{ type: string; data: { agentPreset: string } }>,
            append(type: 'agent-preset/selected', data: { agentPreset: string }) {
              this.events.push({ type, data });
            },
          };
          createdHarnessSession = session;
          const agent = {
            id: options.sessionId,
            ctx: agentContext,
            session,
            followup: vi.fn(),
            cancel: vi.fn(),
            whenIdle: () => Promise.resolve(),
          };
          return { agent, dispose: () => Promise.resolve() };
        },
        get: () => undefined,
      },
      permissionPresets: {
        names: ['read-only', 'workspace-write', 'danger-full-access', 'reviewed'],
        defaultPreset: 'workspace-write',
        current: () => currentPermission,
        optionOf: permissionOption,
        set: (_session, mode) => {
          currentPermission = mode;
          permissionSwitches.push(mode);
        },
      },
      agentPresets: {
        defaultId: 'standard',
        list: async () => [
          ...DEEPSEEK_HARNESS_AGENT_PRESETS.map((preset) => ({
            id: preset.value,
            name: `中文 ${preset.name}`,
            description: `中文 ${preset.description}`,
          })),
          { id: 'custom', name: 'Custom preset', description: 'User-provided preset' },
        ],
        mount: async (_agentContext, id = 'standard') => ({ id }),
        recompose: async (_agentContext, id) => {
          agentPresetSwitches.push(id);
          return { id };
        },
      },
      logger: { warn: vi.fn() },
      on<TArgs extends unknown[]>(
        event: string,
        listener: (...args: TArgs) => unknown
      ): () => void {
        harnessListeners.set(event, listener as Listener);
        return () => harnessListeners.delete(event);
      },
      get: testHarnessService,
      effect: (register) => {
        disposers.push(register());
      },
    };

    apply(context, {
      stream: streams.agent,
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
    });

    const client = new ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' as const } }),
        sessionUpdate: async (notification) => {
          sessionUpdates.push(notification as (typeof sessionUpdates)[number]);
        },
      }),
      streams.client
    );
    const initialized = await client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    expect(initialized.agentInfo?.name).toBe('acp-extension-dsh');
    expect(initialized.agentCapabilities._meta).toEqual({
      lody: { compaction: { version: 1 } },
    });

    const created = await client.newSession({ cwd: process.cwd(), mcpServers: [] });
    expect(created.modes?.currentModeId).toBe('workspace-write');
    expect(selectValue(created.configOptions, 'agent_preset')).toBe('standard');
    expect(selectValue(created.configOptions, 'model')).toBe('deepseek-v4-pro');
    expect(selectValue(created.configOptions, 'reasoning_effort')).toBe('max');
    expect(selectOption(created.configOptions, 'agent_preset')).toMatchObject({
      options: [
        ...DEEPSEEK_HARNESS_AGENT_PRESETS.map((preset) => ({
          value: preset.value,
          name: preset.name,
          description: preset.description,
        })),
        { value: 'custom', name: 'Custom preset', description: 'User-provided preset' },
      ],
    });

    const modelResponse = await client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'model',
      value: 'deepseek-v4-flash',
    });
    expect(selectValue(modelResponse.configOptions, 'model')).toBe('deepseek-v4-flash');

    const effortResponse = await client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'reasoning_effort',
      value: 'low',
    });
    expect(selectOption(effortResponse.configOptions, 'reasoning_effort')).toMatchObject({
      currentValue: 'low',
      options: [
        { value: 'off', name: 'Off' },
        { value: 'low', name: 'Low' },
        { value: 'high', name: 'High' },
        { value: 'max', name: 'Max' },
      ],
    });

    const modeResponse = await client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'mode',
      value: 'reviewed',
    });
    expect(selectOption(modeResponse.configOptions, 'mode')).toMatchObject({
      currentValue: 'reviewed',
      options: expect.arrayContaining([
        {
          value: 'reviewed',
          name: 'Reviewed writes',
          description: 'Use a deployment-defined review policy',
        },
      ]),
    });
    expect(permissionSwitches).toEqual(['reviewed']);

    const sessionEventListener = harnessListeners.get('session/event');
    expect(sessionEventListener).toBeDefined();
    currentPermission = 'custom';
    await sessionEventListener?.(createdHarnessSession, { type: 'sandbox/mode', data: {} });
    await vi.waitFor(() => {
      expect(sessionUpdates).toEqual(
        expect.arrayContaining([
          {
            sessionId: created.sessionId,
            update: { sessionUpdate: 'current_mode_update', currentModeId: 'custom' },
          },
          {
            sessionId: created.sessionId,
            update: expect.objectContaining({
              sessionUpdate: 'config_option_update',
              configOptions: expect.arrayContaining([
                expect.objectContaining({
                  id: 'mode',
                  currentValue: 'custom',
                  options: expect.arrayContaining([
                    expect.objectContaining({ value: 'custom', name: 'Custom' }),
                  ]),
                }),
              ]),
            }),
          },
        ])
      );
    });

    const presetResponse = await client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'agent_preset',
      value: 'minimal',
    });
    expect(selectValue(presetResponse.configOptions, 'agent_preset')).toBe('minimal');
    expect(agentPresetSwitches).toEqual(['minimal']);

    const assemblyListener = scopedListeners.get('system-prompt/assemble') as
      | ((
          assembly: unknown,
          context: unknown,
          next: () => Promise<{ variables: Record<string, unknown> }>
        ) => Promise<{ variables: Record<string, unknown> }>)
      | undefined;
    const requestListener = scopedListeners.get('agent/request') as
      | ((
          payload: unknown,
          next: () => Promise<Record<string, unknown>>
        ) => Promise<Record<string, unknown>>)
      | undefined;
    expect(assemblyListener).toBeDefined();
    expect(requestListener).toBeDefined();
    if (!assemblyListener || !requestListener) throw new Error('missing Harness model listeners');

    await assemblyListener({}, {}, async () => ({ variables: {} }));
    await expect(
      requestListener({}, async () => ({
        provider: 'inherited',
        model: 'inherited',
        reasoningEffort: 'high',
        maxTokens: 4096,
      }))
    ).resolves.toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'low',
      maxTokens: 4096,
    });

    const unlistedModel = await client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'model',
      value: 'gateway-model',
    });
    expect(selectOption(unlistedModel.configOptions, 'model')).toMatchObject({
      currentValue: 'gateway-model',
      options: expect.arrayContaining([
        expect.objectContaining({ value: 'gateway-model', name: 'gateway-model' }),
      ]),
    });

    const noReasoningModel = await client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'model',
      value: 'no-reasoning',
    });
    expect(selectOption(noReasoningModel.configOptions, 'reasoning_effort')).toBeUndefined();
    await expect(
      client.setSessionConfigOption({
        sessionId: created.sessionId,
        configId: 'reasoning_effort',
        value: 'high',
      })
    ).rejects.toThrow(/does not support reasoning effort/u);
  });

  it('mounts ACP MCP servers in the Agent scope and releases their namespaces on close', async () => {
    type AdapterContext = Parameters<typeof apply>[0];
    type TestAgent = NonNullable<ReturnType<AdapterContext['agents']['get']>>;

    const streams = connectedStreams();
    const mountedConfigs: Array<Record<string, unknown>> = [];
    const disposedSessions: string[] = [];
    const agents = new Map<string, TestAgent>();
    const mcpClientPlugin = { apply: vi.fn() };
    const importMcpClient = vi.fn(() => Promise.resolve(mcpClientPlugin));
    let nextMcpMountFailure: Error | undefined;
    const context: AdapterContext = {
      agents: {
        async create(options) {
          const agentContext: Parameters<typeof options.setup>[0] = {
            on: () => () => undefined,
            plugin(_plugin, pluginConfig) {
              mountedConfigs.push({ ...pluginConfig });
              return {
                await: async () => {
                  const failure = nextMcpMountFailure;
                  nextMcpMountFailure = undefined;
                  if (failure) throw failure;
                },
              };
            },
            loader: {
              import: importMcpClient,
              unwrapExports: (exports) => exports,
            },
          };
          await options.setup(agentContext);
          const agent: TestAgent = {
            id: options.sessionId,
            ctx: agentContext,
            session: {
              id: options.sessionId,
              header: { id: options.sessionId },
              events: [],
              append: vi.fn(),
            },
            followup: vi.fn(),
            cancel: vi.fn(),
            whenIdle: () => Promise.resolve(),
          };
          agents.set(agent.id, agent);
          return {
            agent,
            dispose: async () => {
              disposedSessions.push(agent.id);
              agents.delete(agent.id);
            },
          };
        },
        get: (sessionId) => agents.get(sessionId),
      },
      permissionPresets: {
        names: ['read-only', 'workspace-write', 'danger-full-access'],
        defaultPreset: 'workspace-write',
        current: () => 'workspace-write',
        optionOf: permissionOption,
        set: vi.fn(),
      },
      agentPresets: {
        defaultId: 'standard',
        list: async () => [{ id: 'standard' }],
        mount: async (_agentContext, id = 'standard') => ({ id }),
        recompose: async (_agentContext, id) => ({ id }),
      },
      logger: { warn: vi.fn() },
      on: () => () => undefined,
      get: testHarnessService,
      effect: (register) => {
        disposers.push(register());
      },
    };

    apply(context, { stream: streams.agent });
    const client = new ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' as const } }),
        sessionUpdate: async () => undefined,
      }),
      streams.client
    );
    const initialized = await client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    expect(initialized.agentCapabilities.mcpCapabilities).toEqual({ http: true });
    expect(initialized.agentCapabilities.sessionCapabilities?.close).toEqual({});

    const first = await client.newSession({
      cwd: process.cwd(),
      mcpServers: [
        {
          name: 'lody',
          command: process.execPath,
          args: ['lody-mcp.js'],
          env: [{ name: 'LODY_MCP_SESSION_ID', value: 'session-1' }],
        },
        {
          type: 'http',
          name: 'remote tools',
          url: 'https://mcp.example.test',
          headers: [{ name: 'Authorization', value: 'Bearer test' }],
        },
      ],
    });
    expect(importMcpClient).toHaveBeenCalledWith('@deepseek-ai/dsh-mcp-client');
    expect(mountedConfigs).toEqual([
      {
        transport: 'stdio',
        serverName: 'lody',
        command: process.execPath,
        args: ['lody-mcp.js'],
        env: { LODY_MCP_SESSION_ID: 'session-1' },
        cwd: process.cwd(),
        toolCallTimeoutMs: 60_000,
        failOnStartupError: true,
      },
      {
        transport: 'streamable-http',
        serverName: expect.stringMatching(/^remote_tools_[a-f0-9]{8}$/u),
        url: 'https://mcp.example.test',
        headers: { Authorization: 'Bearer test' },
        toolCallTimeoutMs: 60_000,
        failOnStartupError: true,
      },
    ]);

    await client.newSession({
      cwd: process.cwd(),
      mcpServers: [{ name: 'lody', command: process.execPath, args: [], env: [] }],
    });
    expect(mountedConfigs[2]?.serverName).toMatch(/^lody_[a-f0-9]{8}$/u);

    await client.closeSession({ sessionId: first.sessionId });
    expect(disposedSessions).toContain(first.sessionId);

    await client.newSession({
      cwd: process.cwd(),
      mcpServers: [{ name: 'lody', command: process.execPath, args: [], env: [] }],
    });
    expect(mountedConfigs[3]?.serverName).toBe('lody');

    await expect(
      client.newSession({
        cwd: process.cwd(),
        mcpServers: [
          {
            type: 'sse',
            name: 'legacy-sse',
            url: 'https://mcp.example.test/sse',
            headers: [],
          },
        ],
      })
    ).rejects.toThrow(/MCP transport sse is not supported/u);

    nextMcpMountFailure = new Error('MCP startup failed');
    await expect(
      client.newSession({
        cwd: process.cwd(),
        mcpServers: [{ name: 'failing', command: process.execPath, args: [], env: [] }],
      })
    ).rejects.toThrow(/failed to create session: MCP startup failed/u);
    await client.newSession({
      cwd: process.cwd(),
      mcpServers: [{ name: 'failing', command: process.execPath, args: [], env: [] }],
    });
    expect(mountedConfigs.at(-1)?.serverName).toBe('failing');
  });

  it('persists ACP images for the selected vision model and rejects them on text models', async () => {
    type AdapterContext = Parameters<typeof apply>[0];
    type TestAgent = NonNullable<ReturnType<AdapterContext['agents']['get']>>;

    const streams = connectedStreams();
    const agents = new Map<string, TestAgent>();
    const globalListeners = new Map<string, Listener>();
    const updates: unknown[] = [];
    const queuedMessages: unknown[] = [];
    const attachmentRef = {
      attachmentId: `sha256:${'a'.repeat(64)}`,
      mediaType: 'image/png' as const,
      bytes: 3,
      width: 1,
      height: 1,
    };
    const saveImages = vi.fn(async () => [attachmentRef]);
    const attachments = {
      imageLimits: { mediaTypes: ['image/png'] },
      saveImages,
      readImage: vi.fn(async (ref: Awaited<ReturnType<typeof saveImages>>[number]) => ({
        data: Uint8Array.of(1, 2, 3),
        ref,
      })),
    };
    const runtimeModels = [
      {
        provider: 'deepseek-official',
        id: 'runtime-text',
        name: 'Runtime text',
        description: 'Discovered text model',
        inputModalities: ['text'],
      },
      {
        provider: 'deepseek-official',
        id: 'runtime-vision',
        name: 'Runtime vision',
        description: 'Discovered vision model',
        inputModalities: ['text', 'image'],
      },
    ];
    const llm = {
      listModels: vi.fn(async () => runtimeModels),
      resolveModelInfo: vi.fn(async (provider: string, modelId: string) => {
        const model = runtimeModels.find((candidate) => candidate.id === modelId);
        if (!model) throw new Error(`unknown model: ${modelId}`);
        return {
          ...model,
          provider,
          reasoning: {
            efforts: [{ id: 'off', name: 'Off' }],
            defaultEffort: 'off',
          },
        };
      }),
    };
    const context: AdapterContext = {
      agents: {
        async create(options) {
          const agentContext: Parameters<typeof options.setup>[0] = {
            on: () => () => undefined,
            plugin: () => ({ await: () => Promise.resolve() }),
            loader: {
              import: () => Promise.resolve({}),
              unwrapExports: (exports) => exports,
            },
          };
          await options.setup(agentContext);
          const agent: TestAgent = {
            id: options.sessionId,
            ctx: agentContext,
            session: {
              id: options.sessionId,
              header: { id: options.sessionId },
              events: [],
              append: vi.fn(),
            },
            followup: (message) => queuedMessages.push(message),
            cancel: vi.fn(),
            whenIdle: () => Promise.resolve(),
          };
          agents.set(agent.id, agent);
          return { agent, dispose: () => Promise.resolve() };
        },
        get: (sessionId) => agents.get(sessionId),
      },
      permissionPresets: {
        names: ['read-only', 'workspace-write', 'danger-full-access'],
        defaultPreset: 'workspace-write',
        current: () => 'workspace-write',
        optionOf: permissionOption,
        set: vi.fn(),
      },
      agentPresets: {
        defaultId: 'standard',
        list: async () => [{ id: 'standard' }],
        mount: async (_agentContext, id = 'standard') => ({ id }),
        recompose: async (_agentContext, id) => ({ id }),
      },
      logger: { warn: vi.fn() },
      on<TArgs extends unknown[]>(
        event: string,
        listener: (...args: TArgs) => unknown
      ): () => void {
        globalListeners.set(event, listener as Listener);
        return () => globalListeners.delete(event);
      },
      get: (service) => {
        if (service === 'attachments') return attachments;
        if (service === 'llm') return llm;
        return undefined;
      },
      effect: (register) => {
        disposers.push(register());
      },
    };

    apply(context, { stream: streams.agent, model: 'runtime-vision' });
    const client = new ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' as const } }),
        sessionUpdate: async (notification) => {
          updates.push(notification);
        },
      }),
      streams.client
    );
    const initialized = await client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    expect(initialized.agentCapabilities.promptCapabilities.image).toBe(true);
    const session = await client.newSession({ cwd: process.cwd(), mcpServers: [] });
    expect(selectOption(session.configOptions, 'model')).toMatchObject({
      currentValue: 'runtime-vision',
      options: [
        {
          value: 'runtime-text',
          name: 'Runtime text',
          description: 'Discovered text model',
        },
        {
          value: 'runtime-vision',
          name: 'Runtime vision',
          description: 'Discovered vision model',
        },
      ],
    });
    expect(
      (
        session as typeof session & {
          models: {
            currentModelId: string;
            availableModels: Array<{ modelId: string }>;
          };
        }
      ).models
    ).toMatchObject({
      currentModelId: 'runtime-vision',
      availableModels: expect.arrayContaining([
        expect.objectContaining({ modelId: 'runtime-text' }),
        expect.objectContaining({ modelId: 'runtime-text[off]' }),
        expect.objectContaining({ modelId: 'runtime-vision' }),
        expect.objectContaining({ modelId: 'runtime-vision[off]' }),
      ]),
    });
    expect(llm.listModels).toHaveBeenCalledWith('deepseek-official');

    await client.prompt({
      sessionId: session.sessionId,
      prompt: [
        { type: 'text', text: 'What is shown? ' },
        { type: 'image', data: 'AQID', mimeType: 'image/png' },
        { type: 'text', text: 'Be concise.' },
      ],
    });
    expect(saveImages).toHaveBeenCalledWith([
      { data: Uint8Array.of(1, 2, 3), mediaType: 'image/png' },
    ]);
    expect(llm.resolveModelInfo).toHaveBeenCalledWith(
      'deepseek-official',
      'runtime-vision',
      expect.any(AbortSignal)
    );
    expect(queuedMessages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: [
          { type: 'text', text: 'What is shown? ' },
          {
            type: 'image',
            attachment: {
              attachmentId: `sha256:${'a'.repeat(64)}`,
              mediaType: 'image/png',
              bytes: 3,
              width: 1,
              height: 1,
            },
          },
          { type: 'text', text: 'Be concise.' },
        ],
      }),
    ]);

    const sessionEvent = globalListeners.get('session/event');
    const agent = agents.get(session.sessionId);
    if (!sessionEvent || !agent) throw new Error('missing Harness session event listener');
    sessionEvent(agent.session, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'image', attachment: attachmentRef }] } },
    });
    await vi.waitFor(() => {
      expect(updates).toContainEqual({
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'image', data: 'AQID', mimeType: 'image/png' },
        },
      });
    });
    expect(attachments.readImage).toHaveBeenCalledWith(attachmentRef);

    await client.setSessionConfigOption({
      sessionId: session.sessionId,
      configId: 'model',
      value: 'runtime-text',
    });
    await expect(
      client.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'image', data: 'AQID', mimeType: 'image/png' }],
      })
    ).rejects.toThrow(/does not support image input/u);
    expect(saveImages).toHaveBeenCalledTimes(1);
  });

  it('streams Harness reasoning and compaction lifecycle updates', async () => {
    type AdapterContext = Parameters<typeof apply>[0];
    type TestAgent = NonNullable<ReturnType<AdapterContext['agents']['get']>>;

    const streams = connectedStreams();
    const globalListeners = new Map<string, Listener>();
    const updates: unknown[] = [];
    let createdAgent: TestAgent | undefined;
    let markUpdated: (() => void) | undefined;
    const updated = new Promise<void>((resolve) => {
      markUpdated = resolve;
    });

    const context: AdapterContext = {
      agents: {
        async create(options) {
          const agentContext: Parameters<typeof options.setup>[0] = {
            on: () => () => undefined,
            plugin: () => ({ await: () => Promise.resolve() }),
            loader: {
              import: () => Promise.resolve({}),
              unwrapExports: (exports) => exports,
            },
          };
          await options.setup(agentContext);
          createdAgent = {
            id: options.sessionId,
            ctx: agentContext,
            session: {
              id: options.sessionId,
              header: { id: options.sessionId },
              events: [],
              append: vi.fn(),
            },
            followup: vi.fn(),
            cancel: vi.fn(),
            whenIdle: () => Promise.resolve(),
          };
          return { agent: createdAgent, dispose: () => Promise.resolve() };
        },
        get: (sessionId) => (createdAgent?.id === sessionId ? createdAgent : undefined),
      },
      permissionPresets: {
        names: ['read-only', 'workspace-write', 'danger-full-access'],
        defaultPreset: 'workspace-write',
        current: () => 'workspace-write',
        optionOf: permissionOption,
        set: vi.fn(),
      },
      agentPresets: {
        defaultId: 'standard',
        list: async () => [{ id: 'standard' }],
        mount: async (_agentContext, id = 'standard') => ({ id }),
        recompose: async (_agentContext, id) => ({ id }),
      },
      logger: { warn: vi.fn() },
      on<TArgs extends unknown[]>(
        event: string,
        listener: (...args: TArgs) => unknown
      ): () => void {
        globalListeners.set(event, listener as Listener);
        return () => globalListeners.delete(event);
      },
      get: testHarnessService,
      effect: (register) => {
        disposers.push(register());
      },
    };

    apply(context, { stream: streams.agent });
    const client = new ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' as const } }),
        sessionUpdate: async (notification) => {
          updates.push(notification);
          if (updates.length === 8) markUpdated?.();
        },
      }),
      streams.client
    );
    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    const session = await client.newSession({ cwd: process.cwd(), mcpServers: [] });
    const sessionEvent = globalListeners.get('session/event');
    if (!createdAgent || !sessionEvent) throw new Error('missing Harness session event listener');

    sessionEvent(createdAgent.session, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'reasoning-delta', text: 'First thought. ' } },
    });
    sessionEvent(createdAgent.session, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'reasoning-delta', text: '' } },
    });
    sessionEvent(createdAgent.session, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'reasoning-delta', text: 'Second thought.' } },
    });
    sessionEvent(createdAgent.session, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'text-delta', text: 'not forwarded before the final message' } },
    });
    sessionEvent(createdAgent.session, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'block-end', block: { type: 'reasoning' } } },
    });
    sessionEvent(createdAgent.session, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'block-end', block: { type: 'text' } } },
    });
    sessionEvent(createdAgent.session, {
      type: 'assistant/message',
      data: {
        message: {
          content: [
            { type: 'reasoning', text: 'First thought. Second thought.' },
            { type: 'text', text: 'Final answer.' },
          ],
        },
      },
    });
    sessionEvent(createdAgent.session, {
      type: 'compaction/start',
      data: { compactionId: 'manual-1', turn: null },
    });
    sessionEvent(createdAgent.session, {
      type: 'compaction/end',
      data: { compactionId: 'manual-1', turn: null },
    });
    sessionEvent(createdAgent.session, {
      type: 'compaction/start',
      data: { compactionId: 'automatic-1', turn: 2 },
    });
    sessionEvent(createdAgent.session, {
      type: 'compaction/end',
      data: { compactionId: 'automatic-1', turn: 2, error: 'summary failed' },
    });

    await updated;
    expect(updates).toEqual([
      {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'First thought. ' },
        },
      },
      {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Second thought.' },
        },
      },
      {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: '\n\n' },
        },
      },
      {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Final answer.' },
        },
      },
      {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'context-compaction:manual-1',
          title: 'Compacting context',
          kind: 'think',
          status: 'in_progress',
          _meta: {
            lody: {
              activity: { version: 1, kind: 'context_compaction', automatic: false },
            },
          },
        },
      },
      {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'context-compaction:manual-1',
          title: 'Context compacted',
          status: 'completed',
          _meta: {
            lody: {
              activity: { version: 1, kind: 'context_compaction', automatic: false },
            },
          },
        },
      },
      {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'context-compaction:automatic-1',
          title: 'Compacting context',
          kind: 'think',
          status: 'in_progress',
          _meta: {
            lody: {
              activity: { version: 1, kind: 'context_compaction', automatic: true },
            },
          },
        },
      },
      {
        sessionId: session.sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'context-compaction:automatic-1',
          title: 'Context compaction failed',
          status: 'failed',
          _meta: {
            lody: {
              activity: {
                version: 1,
                kind: 'context_compaction',
                automatic: true,
                failureReason: 'summary failed',
              },
            },
          },
        },
      },
    ]);
  });

  it('keeps a cancelled prompt slot until its Harness agent is idle', async () => {
    type AdapterContext = Parameters<typeof apply>[0];
    type TestAgent = NonNullable<ReturnType<AdapterContext['agents']['get']>>;

    const streams = connectedStreams();
    let createdAgent: TestAgent | undefined;
    let markQueued: (() => void) | undefined;
    const queued = new Promise<void>((resolve) => {
      markQueued = resolve;
    });
    let markIdle: (() => void) | undefined;
    const idle = new Promise<void>((resolve) => {
      markIdle = resolve;
    });
    const context: AdapterContext = {
      agents: {
        async create(options) {
          const agentContext: Parameters<typeof options.setup>[0] = {
            on: () => () => undefined,
            plugin: () => ({ await: () => Promise.resolve() }),
            loader: {
              import: () => Promise.resolve({}),
              unwrapExports: (exports) => exports,
            },
          };
          await options.setup(agentContext);
          createdAgent = {
            id: options.sessionId,
            ctx: agentContext,
            session: {
              id: options.sessionId,
              header: { id: options.sessionId },
              events: [],
              append: vi.fn(),
            },
            followup: () => markQueued?.(),
            cancel: vi.fn(),
            whenIdle: () => idle,
          };
          return { agent: createdAgent, dispose: () => Promise.resolve() };
        },
        get: (sessionId) => (createdAgent?.id === sessionId ? createdAgent : undefined),
      },
      permissionPresets: {
        names: ['workspace-write'],
        defaultPreset: 'workspace-write',
        current: () => 'workspace-write',
        optionOf: permissionOption,
        set: vi.fn(),
      },
      agentPresets: {
        defaultId: 'standard',
        list: async () => [{ id: 'standard' }],
        mount: async (_agentContext, id = 'standard') => ({ id }),
        recompose: async (_agentContext, id) => ({ id }),
      },
      logger: { warn: vi.fn() },
      on: () => () => undefined,
      get: testHarnessService,
      effect: (register) => {
        disposers.push(register());
      },
    };

    apply(context, { stream: streams.agent });
    const client = new ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' as const } }),
        sessionUpdate: async () => undefined,
      }),
      streams.client
    );
    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    const session = await client.newSession({ cwd: process.cwd(), mcpServers: [] });
    const firstPrompt = client.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'first' }],
    });
    await queued;

    await client.cancel({ sessionId: session.sessionId });
    await expect(
      client.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'second' }],
      })
    ).rejects.toThrow(/already in flight/u);
    expect(createdAgent?.cancel).toHaveBeenCalledWith({ kind: 'user' });

    markIdle?.();
    await expect(firstPrompt).resolves.toEqual({ stopReason: 'cancelled' });
  });

  it('rejects the active ACP prompt when Harness reports an error for its turn', async () => {
    type AdapterContext = Parameters<typeof apply>[0];
    type TestAgent = NonNullable<ReturnType<AdapterContext['agents']['get']>>;

    const streams = connectedStreams();
    const globalListeners = new Map<string, Listener>();
    let createdAgent: TestAgent | undefined;
    let queuedMessage: { id: string } | undefined;
    let markQueued: (() => void) | undefined;
    const queued = new Promise<void>((resolve) => {
      markQueued = resolve;
    });
    let markIdle: (() => void) | undefined;
    const remainsBusy = new Promise<void>((resolve) => {
      markIdle = resolve;
    });

    const context: AdapterContext = {
      agents: {
        async create(options) {
          const agentContext: Parameters<typeof options.setup>[0] = {
            on: () => () => undefined,
            plugin: () => ({ await: () => Promise.resolve() }),
            loader: {
              import: () => Promise.resolve({}),
              unwrapExports: (exports) => exports,
            },
          };
          await options.setup(agentContext);
          createdAgent = {
            id: options.sessionId,
            ctx: agentContext,
            session: {
              id: options.sessionId,
              header: { id: options.sessionId },
              events: [],
              append: vi.fn(),
            },
            followup(message) {
              queuedMessage = message;
              markQueued?.();
            },
            cancel: vi.fn(),
            whenIdle: () => remainsBusy,
          };
          return { agent: createdAgent, dispose: () => Promise.resolve() };
        },
        get: (sessionId) => (createdAgent?.id === sessionId ? createdAgent : undefined),
      },
      permissionPresets: {
        names: ['read-only', 'workspace-write', 'danger-full-access'],
        defaultPreset: 'workspace-write',
        current: () => 'workspace-write',
        optionOf: permissionOption,
        set: vi.fn(),
      },
      agentPresets: {
        defaultId: 'standard',
        list: async () => [{ id: 'standard' }, { id: 'minimal' }],
        mount: async (_agentContext, id = 'standard') => ({ id }),
        recompose: async (_agentContext, id) => ({ id }),
      },
      logger: { warn: vi.fn() },
      on<TArgs extends unknown[]>(
        event: string,
        listener: (...args: TArgs) => unknown
      ): () => void {
        globalListeners.set(event, listener as Listener);
        return () => globalListeners.delete(event);
      },
      get: testHarnessService,
      effect: (register) => {
        disposers.push(register());
      },
    };

    apply(context, { stream: streams.agent });
    const client = new ClientSideConnection(
      () => ({
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' as const } }),
        sessionUpdate: async () => undefined,
      }),
      streams.client
    );
    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    const session = await client.newSession({ cwd: process.cwd(), mcpServers: [] });
    const prompt = client.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'hello' }],
    });

    await queued;
    await expect(
      client.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: 'agent_preset',
        value: 'minimal',
      })
    ).rejects.toThrow(/fixed after the session has started/u);
    if (!createdAgent || !queuedMessage) throw new Error('prompt was not queued');
    const inboxClaimed = globalListeners.get('agent/inbox/claimed');
    const agentError = globalListeners.get('agent/error');
    if (!inboxClaimed || !agentError) throw new Error('missing Harness lifecycle listeners');
    inboxClaimed({ agent: createdAgent, message: queuedMessage, turn: 7 });
    agentError({ agent: createdAgent, turn: 7, error: new Error('provider failed') });
    markIdle?.();

    await expect(prompt).rejects.toThrow(/turn failed: provider failed/u);
  });
});
