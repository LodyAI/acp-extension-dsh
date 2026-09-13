import { SessionUsageAccumulator } from 'acp-extension-core';
// Official USD / million tokens, checked 2026-09-13:
// https://api-docs.deepseek.com/quick_start/pricing/
// [cache miss, cache hit, output], OFF-PEAK; weekday peak rates are twice these.
const prices = {
    'deepseek-flash': [0.15, 0.003, 0.6],
    // Official aliases now served and billed as DeepSeek-V4.1-Flash.
    'deepseek-v4-flash': [0.15, 0.003, 0.6],
    'deepseek-v4-pro': [0.66, 0.022, 1.98],
    'deepseek-v4-flash-vision-exp': [0.15, 0.003, 0.6],
};
export function deepSeekCostUSD(model, usage, epochMs) {
    const price = Object.hasOwn(prices, model) ? prices[model] : undefined;
    if (!price || !Number.isFinite(epochMs))
        return undefined;
    const date = new Date(epochMs);
    const weekday = date.getUTCDay() >= 1 && date.getUTCDay() <= 5;
    const hour = date.getUTCHours();
    const peak = weekday && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
    // This is a list-price estimate at request completion, not an invoice or a
    // reprice of the cumulative session using the clock at flush time.
    return ((((usage.inputTokens + (usage.cacheCreationInputTokens ?? 0)) * price[0] +
        usage.cacheReadInputTokens * price[1] +
        (usage.outputTokens + (usage.reasoningOutputTokens ?? 0)) * price[2]) *
        (peak ? 2 : 1)) /
        1_000_000);
}
export class HarnessUsageTracker {
    officialEndpoint;
    accumulator = new SessionUsageAccumulator();
    route;
    seen = new Set();
    constructor(officialEndpoint) {
        this.officialEndpoint = officialEndpoint;
    }
    setRoute(provider, model) {
        this.route = { provider, model };
    }
    record(sessionId, seq, time, raw) {
        if (!this.route || !Number.isSafeInteger(seq) || seq < 0)
            return undefined;
        if (this.seen.has(seq))
            return undefined;
        if ([raw.inputTokens, raw.outputTokens, ...Object.values(raw)].some((value) => !Number.isFinite(value) || value < 0))
            return undefined;
        const usage = {
            // Pinned dsh-llm-deepseek already subtracts cache hits from inputTokens.
            inputTokens: raw.inputTokens,
            outputTokens: Math.max(0, raw.outputTokens - (raw.reasoningTokens ?? 0)),
            cacheReadInputTokens: raw.cacheReadTokens ?? 0,
            cacheCreationInputTokens: raw.cacheWriteTokens ?? 0,
            reasoningOutputTokens: raw.reasoningTokens ?? 0,
        };
        if (this.officialEndpoint && this.route.provider === 'deepseek') {
            const costUSD = deepSeekCostUSD(this.route.model, usage, time);
            if (costUSD !== undefined)
                usage.costUSD = costUSD;
        }
        this.seen.add(seq);
        return this.accumulator.update(sessionId, String(seq), { [this.route.model]: usage });
    }
}
//# sourceMappingURL=usage.js.map