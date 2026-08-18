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
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError, } from '@agentclientprotocol/sdk';
import { DEEPSEEK_HARNESS_AGENT_PRESETS, DEEPSEEK_HARNESS_MODELS, DEEPSEEK_HARNESS_PERMISSION_MODES, DEEPSEEK_HARNESS_REASONING_OPTIONS, } from './capabilities.js';
import { ACP_EXTENSION_DSH_VERSION } from './profile.js';
export const name = 'acp-extension-dsh';
// Waiting for persistence/query also preserves the upstream composite's
// startup boundary: ACP cannot accept a session until durability is ready.
export const inject = [
    'agents',
    'agentPresets',
    'loader',
    'permissionPresets',
    'sessionPersistence',
    'sessionQuery',
];
const MODEL_CONFIG_ID = 'model';
const MODE_CONFIG_ID = 'mode';
const REASONING_EFFORT_CONFIG_ID = 'reasoning_effort';
const AGENT_PRESET_CONFIG_ID = 'agent_preset';
const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client';
const MCP_TOOL_CALL_TIMEOUT_MS = 60_000;
const MCP_SERVER_NAME_MAX_LENGTH = 32;
const MCP_SERVER_NAME_HASH_LENGTH = 8;
const INVALID_MCP_SERVER_NAME_CHARS = /[^A-Za-z0-9_-]/gu;
const MODEL_IDS = new Set(DEEPSEEK_HARNESS_MODELS.map((model) => model.modelId));
const PERMISSION_MODE_IDS = new Set(DEEPSEEK_HARNESS_PERMISSION_MODES.map((mode) => mode.id));
const REASONING_EFFORT_IDS = new Set(DEEPSEEK_HARNESS_REASONING_OPTIONS.map((effort) => effort.value));
function invalidParams(detail) {
    return RequestError.invalidParams(undefined, detail);
}
function internalError(detail) {
    return RequestError.internalError(undefined, detail);
}
function nonEmptyString(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function resolveAdapterConfig(config) {
    const provider = nonEmptyString(config?.provider, 'deepseek-official');
    const model = nonEmptyString(config?.model, 'deepseek-v4-pro');
    const reasoningEffort = config?.reasoningEffort ?? 'max';
    if (!MODEL_IDS.has(model)) {
        throw new Error(`acp-extension-dsh: unsupported model ${JSON.stringify(model)}`);
    }
    if (!REASONING_EFFORT_IDS.has(reasoningEffort)) {
        throw new Error(`acp-extension-dsh: unsupported reasoning effort ${JSON.stringify(reasoningEffort)}`);
    }
    return {
        provider,
        model,
        reasoningEffort,
        ...(config?.stream ? { stream: config.stream } : {}),
    };
}
async function loadMcpClientPlugin(agentContext) {
    const module = agentContext.loader.unwrapExports(await agentContext.loader.import(MCP_CLIENT_PACKAGE));
    if (typeof module !== 'object' ||
        module === null ||
        !('apply' in module) ||
        typeof module.apply !== 'function') {
        throw new Error(`${MCP_CLIENT_PACKAGE} does not export a Cordis plugin`);
    }
    return module;
}
function shortHash(value) {
    return createHash('sha256').update(value).digest('hex').slice(0, MCP_SERVER_NAME_HASH_LENGTH);
}
function normalizedMcpServerName(serverName, fallbackIndex) {
    const normalized = serverName.replace(INVALID_MCP_SERVER_NAME_CHARS, '_');
    const base = normalized || `server_${fallbackIndex + 1}`;
    if (base === serverName && base.length <= MCP_SERVER_NAME_MAX_LENGTH)
        return base;
    const hash = shortHash(serverName);
    return `${base.slice(0, MCP_SERVER_NAME_MAX_LENGTH - hash.length - 1)}_${hash}`;
}
function reserveMcpServerNames(servers, sessionId, activeNames) {
    const names = [];
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
            if (released)
                return;
            released = true;
            for (const reservedName of names)
                activeNames.delete(reservedName);
        },
    };
}
function entriesToRecord(entries) {
    return Object.fromEntries(entries.map(({ name: entryName, value }) => [entryName, value]));
}
function mcpClientConfig(server, serverName, cwd) {
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
async function mountMcpServers(agentContext, servers, serverNames, cwd) {
    if (servers.length === 0)
        return;
    const plugin = await loadMcpClientPlugin(agentContext);
    const handles = servers.map((server, index) => {
        const serverName = serverNames[index];
        if (!serverName)
            throw new Error(`missing MCP namespace for server ${index}`);
        return agentContext.plugin(plugin, mcpClientConfig(server, serverName, cwd));
    });
    await Promise.all(handles.map((handle) => handle.await()));
}
function cloneSelection(selection) {
    return { ...selection };
}
function installModelSelection(agentContext, selection) {
    agentContext.on('system-prompt/assemble', async (_assembly, _context, next) => {
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
    });
    agentContext.on('agent/request', async (_payload, next) => {
        const resolved = await next();
        const selected = selection.assembled ?? selection.current;
        const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved;
        return {
            ...withoutInheritedEffort,
            provider: selected.provider,
            model: selected.model,
            reasoningEffort: selected.reasoningEffort,
        };
    });
}
function configOptions(record) {
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
            id: AGENT_PRESET_CONFIG_ID,
            name: 'Agent preset',
            description: 'Tools, prompt, and capabilities composed for the session',
            category: 'agent_preset',
            type: 'select',
            currentValue: record.agentPreset,
            options: record.agentPresetOptions.map((preset) => {
                const builtIn = DEEPSEEK_HARNESS_AGENT_PRESETS.find((candidate) => candidate.value === preset.id);
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
function modeState(record) {
    return {
        currentModeId: record.permissionMode,
        availableModes: DEEPSEEK_HARNESS_PERMISSION_MODES.map((mode) => ({
            id: mode.id,
            name: mode.name,
            description: mode.description ?? null,
        })),
    };
}
function acpPromptToText(prompt) {
    return prompt
        .flatMap((block) => {
        if (block.type === 'text')
            return [block.text];
        if (block.type === 'resource_link') {
            return [
                `\n[resource_link name=${JSON.stringify(block.name)} uri=${JSON.stringify(block.uri)}]\n`,
            ];
        }
        return [];
    })
        .join('');
}
function promptHasUnsupportedContent(prompt) {
    return prompt.some((block) => block.type !== 'text' && block.type !== 'resource_link');
}
function createUserMessage(text) {
    return Object.freeze({
        id: randomUUID(),
        role: 'user',
        content: [Object.freeze({ type: 'text', text })],
        source: Object.freeze({ kind: 'user' }),
    });
}
function turnEndToStopReason(reason) {
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
function errorChain(value) {
    const seen = new Set();
    const render = (current) => {
        if (seen.has(current))
            return '<circular cause>';
        seen.add(current);
        try {
            if (!(current instanceof Error))
                return String(current);
            const message = current.message || current.name;
            const cause = current.cause == null ? '' : render(current.cause);
            return cause && cause !== message ? `${message}: ${cause}` : message;
        }
        finally {
            seen.delete(current);
        }
    };
    return render(value);
}
function validateSessionParams(params) {
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
function requireSelectValue(params) {
    if (typeof params.value !== 'string') {
        throw invalidParams(`${params.configId} requires a select value`);
    }
    return params.value;
}
function assertAllowed(value, allowed, label) {
    if (!allowed.has(value)) {
        throw invalidParams(`unknown ${label}: ${value} (available: ${[...allowed].join(', ')})`);
    }
}
/** Mount the ACP bridge into the surrounding Harness composition. */
export function apply(ctx, rawConfig) {
    const config = resolveAdapterConfig(rawConfig);
    const sessions = new Map();
    const activeMcpServerNames = new Set();
    let closed = false;
    let conn;
    for (const mode of PERMISSION_MODE_IDS) {
        if (!ctx.permissionPresets.names.includes(mode)) {
            throw new Error(`acp-extension-dsh: permission preset ${JSON.stringify(mode)} is not composed`);
        }
    }
    const assertOpen = () => {
        if (closed)
            throw internalError('the ACP bridge has been disposed');
    };
    const requireSession = (sessionId) => {
        const record = sessions.get(sessionId);
        if (!record)
            throw invalidParams(`unknown session: ${sessionId}`);
        return record;
    };
    const ownedRecord = (agent) => {
        const record = sessions.get(agent.session.id);
        return record?.agent === agent ? record : undefined;
    };
    const notify = (notification) => {
        void conn.sessionUpdate(notification).catch((error) => {
            ctx.logger.warn(`acp-extension-dsh: session/update failed: ${String(error)}`);
        });
    };
    const settlePrompt = (record, reason) => {
        const inflight = record.inflight;
        if (!inflight)
            return;
        record.inflight = undefined;
        inflight.resolve(reason);
    };
    const disposeRecords = async (records) => {
        const subagents = ctx.get('subagents');
        if (subagents) {
            try {
                await subagents.drainContinuableDescendants(records.map((record) => record.agent));
            }
            catch (error) {
                ctx.logger.warn(`acp-extension-dsh: continuable subagent teardown failed: ${String(error)}`);
            }
        }
        const results = await Promise.allSettled(records.map((record) => record.dispose()));
        const failures = results
            .filter((result) => result.status === 'rejected')
            .map((result) => result.reason);
        if (failures.length > 0) {
            throw new AggregateError(failures, `DeepSeek ACP teardown failed for ${failures.length} session(s): ${failures
                .map(errorChain)
                .join('; ')}`);
        }
    };
    ctx.on('session/event', (session, event) => {
        const record = sessions.get(session.header.id);
        if (!record || record.agent.session !== session)
            return;
        try {
            if (event.type === 'assistant/chunk' &&
                event.data.chunk?.type === 'reasoning-delta' &&
                typeof event.data.chunk.text === 'string' &&
                event.data.chunk.text.length > 0) {
                notify({
                    sessionId: record.agent.session.id,
                    update: {
                        sessionUpdate: 'agent_thought_chunk',
                        content: { type: 'text', text: event.data.chunk.text },
                    },
                });
            }
            else if (event.type === 'assistant/chunk' &&
                event.data.chunk?.type === 'block-end' &&
                event.data.chunk.block?.type === 'reasoning') {
                notify({
                    sessionId: record.agent.session.id,
                    update: {
                        sessionUpdate: 'agent_thought_chunk',
                        content: { type: 'text', text: '\n\n' },
                    },
                });
            }
            else if (event.type === 'assistant/message') {
                for (const block of event.data.message?.content ?? []) {
                    if (block.type === 'text' && 'text' in block && block.text.length > 0) {
                        notify({
                            sessionId: record.agent.session.id,
                            update: {
                                sessionUpdate: 'agent_message_chunk',
                                content: { type: 'text', text: block.text },
                            },
                        });
                    }
                    else if (block.type === 'image' && 'attachment' in block) {
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
        }
        finally {
            const inflight = record.inflight;
            if (inflight &&
                event.type === 'turn/end' &&
                inflight.turn === event.data.turn &&
                event.data.reason) {
                if (event.data.reason.kind === 'error') {
                    record.inflight = undefined;
                    inflight.reject(internalError(`turn failed: ${event.data.reason.error.message}`));
                }
                else {
                    inflight.endReason = event.data.reason;
                }
            }
        }
    });
    ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
        const inflight = ownedRecord(agent)?.inflight;
        if (inflight && inflight.messageId === message.id)
            inflight.turn = turn;
    });
    ctx.on('agent/error', ({ agent, turn, error }) => {
        const record = ownedRecord(agent);
        const inflight = record?.inflight;
        if (!record || !inflight || (inflight.turn !== undefined && inflight.turn !== turn))
            return;
        record.inflight = undefined;
        inflight.reject(internalError(`turn failed: ${errorChain(error)}`));
    });
    ctx.on('approval/request', (request, next) => {
        const record = ownedRecord(request.agent);
        if (!record || !request.callId)
            return next();
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
            if (outcome.outcome === 'cancelled')
                return 'cancelled';
            return outcome.optionId === 'allow-once' ? 'allowed-once' : 'rejected';
        });
    });
    const setPermissionMode = (record, modeId) => {
        assertAllowed(modeId, PERMISSION_MODE_IDS, 'permission mode');
        ctx.permissionPresets.set(record.agent.session, modeId);
        record.permissionMode = modeId;
    };
    const setConfigOption = (record, params) => {
        const value = requireSelectValue(params);
        if (params.configId === MODE_CONFIG_ID) {
            setPermissionMode(record, value);
        }
        else if (params.configId === AGENT_PRESET_CONFIG_ID) {
            const available = new Set(record.agentPresetOptions.map((preset) => preset.id));
            assertAllowed(value, available, 'agent preset');
            if (value === record.agentPreset)
                return { configOptions: configOptions(record) };
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
                .catch((error) => {
                if (error instanceof RequestError)
                    throw error;
                throw invalidParams(`failed to select agent preset ${JSON.stringify(value)}: ${errorChain(error)}`);
            });
        }
        else if (params.configId === MODEL_CONFIG_ID) {
            assertAllowed(value, MODEL_IDS, 'model');
            record.selection.current = { ...record.selection.current, model: value };
        }
        else if (params.configId === REASONING_EFFORT_CONFIG_ID) {
            assertAllowed(value, REASONING_EFFORT_IDS, 'reasoning effort');
            record.selection.current = {
                ...record.selection.current,
                reasoningEffort: value,
            };
        }
        else {
            throw invalidParams(`unknown config option: ${params.configId}`);
        }
        return { configOptions: configOptions(record) };
    };
    const makeAgent = (connection) => {
        conn = connection;
        return {
            initialize(_params) {
                return Promise.resolve({
                    protocolVersion: PROTOCOL_VERSION,
                    agentInfo: { name: 'acp-extension-dsh', version: ACP_EXTENSION_DSH_VERSION },
                    agentCapabilities: {
                        promptCapabilities: { image: false, audio: false, embeddedContext: false },
                        mcpCapabilities: { http: true },
                        sessionCapabilities: { close: {} },
                    },
                    authMethods: [],
                });
            },
            authenticate(_params) {
                return Promise.resolve();
            },
            async newSession(params) {
                assertOpen();
                validateSessionParams(params);
                const sessionId = randomUUID();
                const selection = {
                    current: {
                        provider: config.provider,
                        model: config.model,
                        reasoningEffort: config.reasoningEffort,
                    },
                };
                const agentPresetOptions = (await ctx.agentPresets.list()).filter((preset) => preset.broken === undefined);
                const requestedPreset = ctx.agentPresets.defaultId;
                if (!agentPresetOptions.some((preset) => preset.id === requestedPreset)) {
                    throw internalError(`default agent preset ${JSON.stringify(requestedPreset)} is unavailable`);
                }
                const mcpServerNames = reserveMcpServerNames(params.mcpServers, sessionId, activeMcpServerNames);
                let mountedPreset = requestedPreset;
                let handle;
                try {
                    handle = await ctx.agents.create({
                        sessionId,
                        meta: { cwd: params.cwd, agentPreset: requestedPreset },
                        agentOptions: { provider: config.provider, model: config.model },
                        setup: async (agentContext) => {
                            installModelSelection(agentContext, selection);
                            mountedPreset = (await ctx.agentPresets.mount(agentContext, requestedPreset)).id;
                            await mountMcpServers(agentContext, params.mcpServers, mcpServerNames.names, params.cwd);
                        },
                    });
                }
                catch (error) {
                    mcpServerNames.release();
                    if (error instanceof RequestError)
                        throw error;
                    throw internalError(`failed to create session: ${errorChain(error)}`);
                }
                const dispose = async () => {
                    try {
                        await handle.dispose();
                    }
                    finally {
                        mcpServerNames.release();
                    }
                };
                if (closed) {
                    await dispose();
                    throw internalError('connection closed during session/new');
                }
                let permissionMode;
                try {
                    permissionMode = ctx.permissionPresets.current(handle.agent.session.events);
                    assertAllowed(permissionMode, PERMISSION_MODE_IDS, 'permission mode');
                }
                catch (error) {
                    await dispose();
                    throw error;
                }
                const record = {
                    agent: handle.agent,
                    dispose,
                    selection,
                    permissionMode,
                    agentPreset: mountedPreset,
                    agentPresetOptions,
                    started: false,
                };
                sessions.set(sessionId, record);
                return {
                    sessionId,
                    modes: modeState(record),
                    configOptions: configOptions(record),
                };
            },
            setSessionMode(params) {
                const record = requireSession(params.sessionId);
                setPermissionMode(record, params.modeId);
            },
            setSessionConfigOption(params) {
                return setConfigOption(requireSession(params.sessionId), params);
            },
            async prompt(params) {
                assertOpen();
                const record = requireSession(params.sessionId);
                if (record.inflight)
                    throw invalidParams('a prompt is already in flight for this session');
                if (promptHasUnsupportedContent(params.prompt)) {
                    throw invalidParams('only text and resource_link prompt content is supported');
                }
                const text = acpPromptToText(params.prompt);
                if (!text.trim())
                    throw invalidParams('empty prompt');
                if (ctx.agents.get(record.agent.id) !== record.agent) {
                    throw internalError('prompt was not queued: the agent was disposed outside the bridge');
                }
                const message = createUserMessage(text);
                record.started = true;
                const stopReason = await new Promise((resolve, reject) => {
                    const inflight = { resolve, reject, messageId: message.id };
                    record.inflight = inflight;
                    try {
                        record.agent.followup(message);
                    }
                    catch (error) {
                        record.inflight = undefined;
                        record.started = false;
                        throw internalError(`prompt was not queued: ${error instanceof Error ? error.message : String(error)}`);
                    }
                    void record.agent.whenIdle().then(() => {
                        if (record.inflight !== inflight)
                            return;
                        record.inflight = undefined;
                        const end = inflight.endReason;
                        inflight.resolve(end
                            ? end.kind === 'max-tokens'
                                ? 'end_turn'
                                : turnEndToStopReason(end)
                            : 'cancelled');
                    });
                });
                return { stopReason };
            },
            cancel(params) {
                const record = sessions.get(params.sessionId);
                if (!record)
                    return Promise.resolve();
                record.agent.cancel({ kind: 'user' });
                settlePrompt(record, 'cancelled');
                return Promise.resolve();
            },
            async closeSession(params) {
                const record = requireSession(params.sessionId);
                sessions.delete(params.sessionId);
                record.agent.cancel({ kind: 'user' });
                settlePrompt(record, 'cancelled');
                await disposeRecords([record]);
            },
        };
    };
    const stream = config.stream ??
        ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
    conn = new AgentSideConnection(makeAgent, stream);
    let quiescing;
    const quiesce = () => {
        if (quiescing)
            return quiescing;
        closed = true;
        const records = [...sessions.values()];
        sessions.clear();
        for (const record of records) {
            record.agent.cancel({ kind: 'user' });
            settlePrompt(record, 'cancelled');
        }
        quiescing = (async () => {
            await disposeRecords(records);
        })();
        return quiescing;
    };
    void conn.closed
        .catch((error) => {
        ctx.logger.warn(`acp-extension-dsh: connection closed with an error: ${String(error)}`);
    })
        .then(quiesce)
        .catch((error) => {
        ctx.logger.warn(`acp-extension-dsh: connection-close teardown failed: ${String(error)}`);
    });
    ctx.effect(() => quiesce, 'acp-extension-dsh.connection');
}
//# sourceMappingURL=adapter.js.map