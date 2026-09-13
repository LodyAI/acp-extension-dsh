import { type ModelUsage } from 'acp-extension-core';
export type HarnessTokenUsage = {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
};
export declare function deepSeekCostUSD(model: string, usage: ModelUsage, epochMs: number): number | undefined;
export declare class HarnessUsageTracker {
    private readonly officialEndpoint;
    private accumulator;
    private route?;
    private seen;
    constructor(officialEndpoint: boolean);
    setRoute(provider: string, model: string): void;
    record(sessionId: string, seq: number, time: number, raw: HarnessTokenUsage): import("acp-extension-core").SessionUsageUpdate | undefined;
}
//# sourceMappingURL=usage.d.ts.map