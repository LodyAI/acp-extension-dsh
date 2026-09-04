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
export declare const DEEPSEEK_HARNESS_MODELS: readonly [{
    readonly modelId: "deepseek-v4-flash";
    readonly name: "DeepSeek-V4-Flash";
    readonly description: "Faster DeepSeek Harness coding model.";
    readonly inputModalities: readonly ["text"];
}, {
    readonly modelId: "deepseek-v4-pro";
    readonly name: "DeepSeek-V4-Pro";
    readonly description: "More capable DeepSeek Harness coding model.";
    readonly inputModalities: readonly ["text"];
}, {
    readonly modelId: "deepseek-v4-flash-vision-exp";
    readonly name: "DeepSeek-V4-Flash-Vision-Exp";
    readonly description: "Experimental multimodal DeepSeek model with image understanding.";
    readonly inputModalities: readonly ["text", "image"];
}];
export declare const DEEPSEEK_HARNESS_REASONING_OPTIONS: readonly [{
    readonly value: "off";
    readonly name: "Off";
    readonly description: "Disable extended thinking";
}, {
    readonly value: "low";
    readonly name: "Low";
    readonly description: "Use a smaller reasoning budget";
}, {
    readonly value: "high";
    readonly name: "High";
    readonly description: "Use the standard reasoning budget";
}, {
    readonly value: "max";
    readonly name: "Max";
    readonly description: "Use the maximum reasoning budget";
}];
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
/**
 * Optional JSON string-array of model ids used to replace the DeepSeek
 * provider's advisory catalog. The generated host profile maps each id to a
 * DSH catalog entry and selects the first one for new ACP sessions.
 */
export declare const ACP_EXTENSION_DSH_MODELS_ENV = "ACP_EXTENSION_DSH_MODELS";
//# sourceMappingURL=capabilities.d.ts.map