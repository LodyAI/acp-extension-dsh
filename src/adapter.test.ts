import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type AnyMessage,
  type SessionConfigOption,
  type Stream,
} from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apply } from './adapter.js';

type Listener = (...args: unknown[]) => unknown;

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

describe('DeepSeek Harness ACP adapter', () => {
  const disposers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(disposers.splice(0).map((dispose) => dispose()));
  });

  it('applies model, reasoning-effort, and permission selections to Harness state', async () => {
    const streams = connectedStreams();
    const scopedListeners = new Map<string, Listener>();
    const permissionSwitches: string[] = [];
    let currentPermission = 'workspace-write';

    const context: Parameters<typeof apply>[0] = {
      agents: {
        async create(options) {
          options.setup({
            on<TArgs extends unknown[]>(
              event: string,
              listener: (...args: TArgs) => unknown
            ): () => void {
              scopedListeners.set(event, listener as Listener);
              return () => scopedListeners.delete(event);
            },
          });
          const session = {
            id: options.sessionId,
            header: { id: options.sessionId },
            events: [],
          };
          const agent = {
            id: options.sessionId,
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
        names: ['read-only', 'workspace-write', 'danger-full-access'],
        defaultPreset: 'workspace-write',
        current: () => currentPermission,
        set: (_session, mode) => {
          currentPermission = mode;
          permissionSwitches.push(mode);
        },
      },
      logger: { warn: vi.fn() },
      on<TArgs extends unknown[]>(
        _event: string,
        _listener: (...args: TArgs) => unknown
      ): () => void {
        return () => undefined;
      },
      get: () => undefined,
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
        sessionUpdate: async () => undefined,
      }),
      streams.client
    );
    const initialized = await client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    expect(initialized.agentInfo?.name).toBe('acp-extension-dsh');

    const created = await client.newSession({ cwd: process.cwd(), mcpServers: [] });
    expect(created.modes?.currentModeId).toBe('workspace-write');
    expect(selectValue(created.configOptions, 'model')).toBe('deepseek-v4-pro');
    expect(selectValue(created.configOptions, 'reasoning_effort')).toBe('max');

    const modelResponse = await client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'model',
      value: 'deepseek-v4-flash',
    });
    expect(selectValue(modelResponse.configOptions, 'model')).toBe('deepseek-v4-flash');

    const effortResponse = await client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'reasoning_effort',
      value: 'off',
    });
    expect(selectValue(effortResponse.configOptions, 'reasoning_effort')).toBe('off');

    const modeResponse = await client.setSessionConfigOption({
      sessionId: created.sessionId,
      configId: 'mode',
      value: 'danger-full-access',
    });
    expect(selectValue(modeResponse.configOptions, 'mode')).toBe('danger-full-access');
    expect(permissionSwitches).toEqual(['danger-full-access']);

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
      reasoningEffort: 'off',
      maxTokens: 4096,
    });

    await expect(
      client.setSessionConfigOption({
        sessionId: created.sessionId,
        configId: 'model',
        value: 'not-a-model',
      })
    ).rejects.toThrow(/unknown model/u);
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
    const remainsBusy = new Promise<void>(() => undefined);

    const context: AdapterContext = {
      agents: {
        async create(options) {
          options.setup({ on: () => () => undefined });
          createdAgent = {
            id: options.sessionId,
            session: {
              id: options.sessionId,
              header: { id: options.sessionId },
              events: [],
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
        set: vi.fn(),
      },
      logger: { warn: vi.fn() },
      on<TArgs extends unknown[]>(
        event: string,
        listener: (...args: TArgs) => unknown
      ): () => void {
        globalListeners.set(event, listener as Listener);
        return () => globalListeners.delete(event);
      },
      get: () => undefined,
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
    if (!createdAgent || !queuedMessage) throw new Error('prompt was not queued');
    const inboxClaimed = globalListeners.get('agent/inbox/claimed');
    const agentError = globalListeners.get('agent/error');
    if (!inboxClaimed || !agentError) throw new Error('missing Harness lifecycle listeners');
    inboxClaimed({ agent: createdAgent, message: queuedMessage, turn: 7 });
    agentError({ agent: createdAgent, turn: 7, error: new Error('provider failed') });

    await expect(prompt).rejects.toThrow(/turn failed: provider failed/u);
  });
});
