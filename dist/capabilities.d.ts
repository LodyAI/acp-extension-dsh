/** Stable ACP selector vocabulary backed by the composed DeepSeek Harness profile. */
export declare const DEEPSEEK_HARNESS_PERMISSION_MODES: readonly [{
    readonly id: "read-only";
    readonly name: "Read-only";
    readonly description: "Read inside the workspace; protected writes require one-time approval.";
}, {
    readonly id: "workspace-write";
    readonly name: "Workspace write";
    readonly description: "Read and write inside the workspace; wider access requires one-time approval.";
}, {
    readonly id: "danger-full-access";
    readonly name: "Full access";
    readonly description: "Allow unrestricted file and command access without approval prompts.";
}];
/** Upstream DeepSeek connection settings consumed by the provider and ACP discovery. */
export declare const DEEPSEEK_HARNESS_API_KEY_ENV = "DEEPSEEK_API_KEY";
export declare const DEEPSEEK_HARNESS_BASE_URL_ENV = "DEEPSEEK_BASE_URL";
/** Built-in agent compositions shipped by the official DeepSeek Harness CLI. */
export declare const DEEPSEEK_HARNESS_AGENT_PRESETS: readonly [{
    readonly value: "standard";
    readonly name: "Standard mode";
    readonly description: "Full coding agent with file editing, shell, search, skills, planning, goals, subagents, and workflows.";
}, {
    readonly value: "code";
    readonly name: "PTC mode";
    readonly description: "Standard capabilities exposed through the Code Mode SDK for multi-step TypeScript programs.";
}, {
    readonly value: "minimal";
    readonly name: "Minimal mode";
    readonly description: "Two-tool coding agent with persistent bash and str_replace_editor.";
}, {
    readonly value: "cordis";
    readonly name: "Creator mode";
    readonly description: "Standard capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.";
}];
//# sourceMappingURL=capabilities.d.ts.map