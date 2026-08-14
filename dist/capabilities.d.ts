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
}, {
    readonly modelId: "deepseek-v4-pro";
    readonly name: "DeepSeek-V4-Pro";
    readonly description: "More capable DeepSeek Harness coding model.";
}];
export declare const DEEPSEEK_HARNESS_REASONING_OPTIONS: readonly [{
    readonly value: "off";
    readonly name: "Off";
    readonly description: "Disable extended thinking";
}, {
    readonly value: "high";
    readonly name: "High";
    readonly description: "Use the standard reasoning budget";
}, {
    readonly value: "max";
    readonly name: "Max";
    readonly description: "Use the maximum reasoning budget";
}];
//# sourceMappingURL=capabilities.d.ts.map