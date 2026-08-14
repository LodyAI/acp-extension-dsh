/**
 * ACP surface for DeepSeek Harness.
 *
 * The upstream ACP plugin intentionally exposes only automation basics. This
 * adapter keeps its prompt, lifecycle, cancellation, and one-shot approval
 * behavior while adding standard ACP session controls backed by Harness's
 * per-agent model waterfall and permission-preset service.
 */
import { randomUUID } from 'node:crypto';
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
  type InitializeRequest,
  type InitializeResponse,
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
import {
  DEEPSEEK_HARNESS_MODELS,
  DEEPSEEK_HARNESS_PERMISSION_MODES,
  DEEPSEEK_HARNESS_REASONING_OPTIONS,
} from './capabilities.js';
import { ACP_EXTENSION_DSH_VERSION } from './profile.js';

export const name = 'acp-extension-dsh';
// Waiting for persistence/query also preserves the upstream composite's
// startup boundary: ACP cannot accept a session until durability is ready.
export const inject = ['agents', 'permissionPresets', 'sessionPersistence', 'sessionQuery'];

type ReasoningEffort = 'off' | 'high' | 'max';

type ModelSelection = {
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
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
type HarnessImageBlock = {
  type: 'image';
  attachment: { attachmentId: string };
};
type HarnessMessageBlock = HarnessTextBlock | HarnessImageBlock | { type: string };

type HarnessTurnEndReason =
  | { kind: 'completed' | 'max-tokens' | 'aborted' | 'interrupted' | 'blocked' }
  | { kind: 'error'; error: { message: string } };

type HarnessSessionEvent = {
  type: string;
  data: {
    turn?: number;
    reason?: HarnessTurnEndReason;
    message?: { content: HarnessMessageBlock[] };
  };
};

type HarnessSession = {
  id: string;
  header: { id: string };
  events: readonly HarnessSessionEvent[];
};

type HarnessAgent = {
  id: string;
  session: HarnessSession;
  followup(message: HarnessUserMessage): void;
  cancel(cause: { kind: 'user' }): void;
  whenIdle(): Promise<void>;
};

type HarnessUserMessage = {
  id: string;
  role: 'user';
  content: Array<{ type: 'text'; text: string }>;
  source: { kind: 'user' };
};

type HarnessAgentContext = {
  on<TArgs extends unknown[]>(event: string, listener: (...args: TArgs) => unknown): () => void;
};

type HarnessAgentHandle = {
  agent: HarnessAgent;
  dispose(): Promise<void>;
};

type HarnessContext = {
  agents: {
    create(options: {
      sessionId: string;
      meta: { cwd: string };
      agentOptions: { provider: string; model: string };
      setup(agentContext: HarnessAgentContext): void;
    }): Promise<HarnessAgentHandle>;
    get(sessionId: string): HarnessAgent | undefined;
  };
  permissionPresets: {
    names: readonly string[];
    defaultPreset: string;
    current(events: readonly HarnessSessionEvent[]): string;
    set(session: HarnessSession, name: string): void;
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
  reasoningEffort?: ReasoningEffort;
  /** Runtime-only transport override used by unit tests. */
  stream?: Stream;
};

type ResolvedAdapterConfig = {
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  stream?: Stream;
};

type InflightPrompt = {
  resolve(reason: StopReason): void;
  reject(error: Error): void;
  messageId: string;
  turn?: number;
  endReason?: HarnessTurnEndReason;
};

type SessionRecord = {
  agent: HarnessAgent;
  dispose(): Promise<void>;
  selection: ModelSelectionRef;
  permissionMode: string;
  inflight?: InflightPrompt;
};

type ContinuableDrain = {
  drainContinuableDescendants(parents: readonly HarnessAgent[]): Promise<void>;
};

const MODEL_CONFIG_ID = 'model';
const MODE_CONFIG_ID = 'mode';
const REASONING_EFFORT_CONFIG_ID = 'reasoning_effort';

const MODEL_IDS = new Set<string>(DEEPSEEK_HARNESS_MODELS.map((model) => model.modelId));
const PERMISSION_MODE_IDS = new Set<string>(
  DEEPSEEK_HARNESS_PERMISSION_MODES.map((mode) => mode.id)
);
const REASONING_EFFORT_IDS = new Set<string>(
  DEEPSEEK_HARNESS_REASONING_OPTIONS.map((effort) => effort.value)
);

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
  const reasoningEffort = config?.reasoningEffort ?? 'max';
  if (!MODEL_IDS.has(model)) {
    throw new Error(`acp-extension-dsh: unsupported model ${JSON.stringify(model)}`);
  }
  if (!REASONING_EFFORT_IDS.has(reasoningEffort)) {
    throw new Error(
      `acp-extension-dsh: unsupported reasoning effort ${JSON.stringify(reasoningEffort)}`
    );
  }
  return {
    provider,
    model,
    reasoningEffort,
    ...(config?.stream ? { stream: config.stream } : {}),
  };
}

function cloneSelection(selection: ModelSelection): ModelSelection {
  return { ...selection };
}

function installModelSelection(
  agentContext: HarnessAgentContext,
  selection: ModelSelectionRef
): void {
  agentContext.on(
    'system-prompt/assemble',
    async (_assembly: unknown, _context: unknown, next: () => Promise<HarnessPromptAssembly>) => {
      const selected = cloneSelection(selection.current);
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
        reasoningEffort: selected.reasoningEffort,
      };
    }
  );
}

function configOptions(record: SessionRecord): SessionConfigOption[] {
  return [
    {
      id: MODE_CONFIG_ID,
      name: 'Permission',
      description: 'Sandbox and approval policy for the session',
      category: 'mode',
      type: 'select',
      currentValue: record.permissionMode,
      options: DEEPSEEK_HARNESS_PERMISSION_MODES.map((mode) => ({
        value: mode.id,
        name: mode.name,
        description: mode.description ?? null,
      })),
    },
    {
      id: MODEL_CONFIG_ID,
      name: 'Model',
      description: 'DeepSeek model used for the session',
      category: 'model',
      type: 'select',
      currentValue: record.selection.current.model,
      options: DEEPSEEK_HARNESS_MODELS.map((model) => ({
        value: model.modelId,
        name: model.name,
        description: model.description ?? null,
      })),
    },
    {
      id: REASONING_EFFORT_CONFIG_ID,
      name: 'Reasoning effort',
      description: 'How much reasoning effort the model should use',
      category: 'thought_level',
      type: 'select',
      currentValue: record.selection.current.reasoningEffort,
      options: DEEPSEEK_HARNESS_REASONING_OPTIONS.map((effort) => ({
        value: effort.value,
        name: effort.name,
        description: effort.description ?? null,
      })),
    },
  ];
}

function modeState(record: SessionRecord): SessionModeState {
  return {
    currentModeId: record.permissionMode,
    availableModes: DEEPSEEK_HARNESS_PERMISSION_MODES.map((mode) => ({
      id: mode.id,
      name: mode.name,
      description: mode.description ?? null,
    })),
  };
}

function acpPromptToText(prompt: PromptRequest['prompt']): string {
  return prompt
    .flatMap((block) => {
      if (block.type === 'text') return [block.text];
      if (block.type === 'resource_link') {
        return [
          `\n[resource_link name=${JSON.stringify(block.name)} uri=${JSON.stringify(block.uri)}]\n`,
        ];
      }
      return [];
    })
    .join('');
}

function promptHasUnsupportedContent(prompt: PromptRequest['prompt']): boolean {
  return prompt.some((block) => block.type !== 'text' && block.type !== 'resource_link');
}

function createUserMessage(text: string): HarnessUserMessage {
  return Object.freeze({
    id: randomUUID(),
    role: 'user' as const,
    content: [Object.freeze({ type: 'text' as const, text })],
    source: Object.freeze({ kind: 'user' as const }),
  });
}

function turnEndToStopReason(reason: HarnessTurnEndReason): StopReason {
  switch (reason.kind) {
    case 'completed':
      return 'end_turn';
    case 'max-tokens':
      return 'max_tokens';
    case 'interrupted':
      return 'cancelled';
    case 'aborted':
    case 'blocked':
    case 'error':
      return 'end_turn';
    default:
      return 'end_turn';
  }
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
  if (params.mcpServers.length > 0) {
    throw invalidParams('mcpServers is not supported');
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
  let closed = false;
  let conn: AgentSideConnection;

  for (const mode of PERMISSION_MODE_IDS) {
    if (!ctx.permissionPresets.names.includes(mode)) {
      throw new Error(
        `acp-extension-dsh: permission preset ${JSON.stringify(mode)} is not composed`
      );
    }
  }

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

  const notify = (notification: SessionNotification): void => {
    void conn.sessionUpdate(notification).catch((error: unknown) => {
      ctx.logger.warn(`acp-extension-dsh: session/update failed: ${String(error)}`);
    });
  };

  const settlePrompt = (record: SessionRecord, reason: StopReason): void => {
    const inflight = record.inflight;
    if (!inflight) return;
    record.inflight = undefined;
    inflight.resolve(reason);
  };

  ctx.on('session/event', (session: HarnessSession, event: HarnessSessionEvent) => {
    const record = sessions.get(session.header.id);
    if (!record || record.agent.session !== session) return;
    try {
      if (event.type === 'assistant/message') {
        for (const block of event.data.message?.content ?? []) {
          if (block.type === 'text' && 'text' in block && block.text.length > 0) {
            notify({
              sessionId: record.agent.session.id,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: block.text },
              },
            });
          } else if (block.type === 'image' && 'attachment' in block) {
            notify({
              sessionId: record.agent.session.id,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: {
                  type: 'text',
                  text: `[image attachment ${block.attachment.attachmentId}]`,
                },
              },
            });
          }
        }
      }
    } finally {
      const inflight = record.inflight;
      if (
        inflight &&
        event.type === 'turn/end' &&
        inflight.turn === event.data.turn &&
        event.data.reason
      ) {
        if (event.data.reason.kind === 'error') {
          record.inflight = undefined;
          inflight.reject(internalError(`turn failed: ${event.data.reason.error.message}`));
        } else {
          inflight.endReason = event.data.reason;
        }
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
      if (!record || !inflight || (inflight.turn !== undefined && inflight.turn !== turn)) return;
      record.inflight = undefined;
      inflight.reject(internalError(`turn failed: ${errorChain(error)}`));
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
    assertAllowed(modeId, PERMISSION_MODE_IDS, 'permission mode');
    ctx.permissionPresets.set(record.agent.session, modeId);
    record.permissionMode = modeId;
  };

  const setConfigOption = (
    record: SessionRecord,
    params: SetSessionConfigOptionRequest
  ): SetSessionConfigOptionResponse => {
    const value = requireSelectValue(params);
    if (params.configId === MODE_CONFIG_ID) {
      setPermissionMode(record, value);
    } else if (params.configId === MODEL_CONFIG_ID) {
      assertAllowed(value, MODEL_IDS, 'model');
      record.selection.current = { ...record.selection.current, model: value };
    } else if (params.configId === REASONING_EFFORT_CONFIG_ID) {
      assertAllowed(value, REASONING_EFFORT_IDS, 'reasoning effort');
      record.selection.current = {
        ...record.selection.current,
        reasoningEffort: value as ReasoningEffort,
      };
    } else {
      throw invalidParams(`unknown config option: ${params.configId}`);
    }
    return { configOptions: configOptions(record) };
  };

  const makeAgent = (connection: AgentSideConnection): AcpAgent => {
    conn = connection;
    return {
      initialize(_params: InitializeRequest): Promise<InitializeResponse> {
        return Promise.resolve({
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: 'acp-extension-dsh', version: ACP_EXTENSION_DSH_VERSION },
          agentCapabilities: {
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
          },
          authMethods: [],
        });
      },

      authenticate(_params: AuthenticateRequest): Promise<void> {
        return Promise.resolve();
      },

      async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
        assertOpen();
        validateSessionParams(params);
        const sessionId = randomUUID();
        const selection: ModelSelectionRef = {
          current: {
            provider: config.provider,
            model: config.model,
            reasoningEffort: config.reasoningEffort,
          },
        };
        const handle = await ctx.agents.create({
          sessionId,
          meta: { cwd: params.cwd },
          agentOptions: { provider: config.provider, model: config.model },
          setup: (agentContext) => installModelSelection(agentContext, selection),
        });
        if (closed) {
          await handle.dispose();
          throw internalError('connection closed during session/new');
        }
        const permissionMode = ctx.permissionPresets.current(handle.agent.session.events);
        assertAllowed(permissionMode, PERMISSION_MODE_IDS, 'permission mode');
        const record: SessionRecord = {
          agent: handle.agent,
          dispose: () => handle.dispose(),
          selection,
          permissionMode,
        };
        sessions.set(sessionId, record);
        return {
          sessionId,
          modes: modeState(record),
          configOptions: configOptions(record),
        };
      },

      setSessionMode(params: SetSessionModeRequest): void {
        const record = requireSession(params.sessionId);
        setPermissionMode(record, params.modeId);
      },

      setSessionConfigOption(
        params: SetSessionConfigOptionRequest
      ): SetSessionConfigOptionResponse {
        return setConfigOption(requireSession(params.sessionId), params);
      },

      async prompt(params: PromptRequest): Promise<PromptResponse> {
        assertOpen();
        const record = requireSession(params.sessionId);
        if (record.inflight) throw invalidParams('a prompt is already in flight for this session');
        if (promptHasUnsupportedContent(params.prompt)) {
          throw invalidParams('only text and resource_link prompt content is supported');
        }
        const text = acpPromptToText(params.prompt);
        if (!text.trim()) throw invalidParams('empty prompt');
        if (ctx.agents.get(record.agent.id) !== record.agent) {
          throw internalError('prompt was not queued: the agent was disposed outside the bridge');
        }
        const message = createUserMessage(text);
        const stopReason = await new Promise<StopReason>((resolve, reject) => {
          const inflight: InflightPrompt = { resolve, reject, messageId: message.id };
          record.inflight = inflight;
          try {
            record.agent.followup(message);
          } catch (error: unknown) {
            record.inflight = undefined;
            throw internalError(
              `prompt was not queued: ${error instanceof Error ? error.message : String(error)}`
            );
          }
          void record.agent.whenIdle().then(() => {
            if (record.inflight !== inflight) return;
            record.inflight = undefined;
            const end = inflight.endReason;
            inflight.resolve(
              end
                ? end.kind === 'max-tokens'
                  ? 'end_turn'
                  : turnEndToStopReason(end)
                : 'cancelled'
            );
          });
        });
        return { stopReason };
      },

      cancel(params: CancelNotification): Promise<void> {
        const record = sessions.get(params.sessionId);
        if (!record) return Promise.resolve();
        record.agent.cancel({ kind: 'user' });
        settlePrompt(record, 'cancelled');
        return Promise.resolve();
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
      record.agent.cancel({ kind: 'user' });
      settlePrompt(record, 'cancelled');
    }
    quiescing = (async () => {
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
