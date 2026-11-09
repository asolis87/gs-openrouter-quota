import { fetchKeyInfo, OPENROUTER_ENV_KEY, OPENROUTER_PROVIDER, type KeyInfo } from "./openrouter.ts";

// Gentle Shell's alt+u integration. gentle-shell exposes a generic usage-source
// hook on pi.events; these shapes mirror its documented contract
// (gentle-pi.usage-source/v1) so this package never imports gentle-shell.
// The shell renders percentages only, so dollars live in /openrouter instead.

export const USAGE_SOURCE_EVENT = "gentle-pi:usage-source/v1";
export const USAGE_SOURCE_SCHEMA = "gentle-pi.usage-source/v1";

export interface UsageWindow {
	label: string;
	/** 0-100. */
	usedPercent: number;
	windowSeconds: number;
	/** Epoch milliseconds, or null when the window never resets. */
	resetAt: number | null;
}

export interface UsageLimit {
	name: string;
	windows: UsageWindow[];
	limitReached: boolean;
}

export interface ProviderUsage {
	provider: string;
	plan: string | undefined;
	limits: UsageLimit[];
	fetchedAt: number;
}

export interface UsageSource {
	schema: typeof USAGE_SOURCE_SCHEMA;
	provider: string;
	pendingNote?: string;
	fetch(apiKey: string | undefined, fetchFn: typeof fetch, now: number): Promise<ProviderUsage | undefined>;
}

const DAY = 86_400;
const WINDOW: Record<string, { label: string; seconds: number }> = {
	daily: { label: "day", seconds: DAY },
	weekly: { label: "week", seconds: 7 * DAY },
	monthly: { label: "month", seconds: 30 * DAY },
};

/** Next UTC rollover for OpenRouter's daily, weekly (Monday) and monthly windows. */
export function nextReset(interval: string | null, now: number): number | null {
	const d = new Date(now);
	const y = d.getUTCFullYear();
	const m = d.getUTCMonth();
	const day = d.getUTCDate();
	if (interval === "daily") return Date.UTC(y, m, day + 1);
	if (interval === "weekly") {
		const sinceMonday = (d.getUTCDay() + 6) % 7;
		return Date.UTC(y, m, day - sinceMonday + 7);
	}
	if (interval === "monthly") return Date.UTC(y, m + 1, 1);
	return null;
}

function percent(used: number, limit: number): number {
	if (limit <= 0) return used > 0 ? 100 : 0;
	return Math.min(100, Math.max(0, Math.round((used / limit) * 1000) / 10));
}

function window(interval: string | null, usedPercent: number, resetAt: number | null): UsageWindow {
	const shape = interval ? WINDOW[interval] : undefined;
	return { label: shape?.label ?? "", usedPercent, windowSeconds: shape?.seconds ?? 0, resetAt };
}

// limitReached feeds gentle-shell's model fallback; no limit sets
// scope:"provider", so an exhausted budget never benches all of openrouter.
export function toProviderUsage(info: KeyInfo, now: number): ProviderUsage {
	const limits: UsageLimit[] = [];
	for (const budget of info.budgets) {
		// The key's own limit is reported separately below with its own numbers.
		if (budget.scope === "key_limit" && info.keyLimit) continue;
		const used = percent(budget.spendUsd, budget.limitUsd);
		limits.push({
			name: `${budget.scope.replace(/_/g, " ")} budget`,
			limitReached: budget.remainingUsd <= 0,
			windows: [window(budget.resetInterval, used, budget.resetsAt ?? nextReset(budget.resetInterval, now))],
		});
	}
	if (info.keyLimit) {
		const { limit, remaining, reset } = info.keyLimit;
		limits.push({
			name: "key",
			limitReached: remaining <= 0,
			windows: [window(reset, percent(limit - remaining, limit), nextReset(reset, now))],
		});
	}
	if (info.freeRequests) {
		const { used, limit, remaining } = info.freeRequests;
		limits.push({ name: "free models", limitReached: remaining <= 0, windows: [window("daily", percent(used, limit), nextReset("daily", now))] });
	}
	// The shell's bar shows the first limit, so the most pressing one leads.
	limits.sort((a, b) => b.windows[0]!.usedPercent - a.windows[0]!.usedPercent);
	return { provider: OPENROUTER_PROVIDER, plan: info.isFreeTier ? "free" : "paid", limits, fetchedAt: now };
}

export function createUsageSource(env: Record<string, string | undefined>): UsageSource {
	return {
		schema: USAGE_SOURCE_SCHEMA,
		provider: OPENROUTER_PROVIDER,
		pendingNote: "no usage yet · r to fetch · /openrouter for $",
		async fetch(apiKey, fetchFn, now) {
			const key = apiKey?.trim() || env[OPENROUTER_ENV_KEY]?.trim() || undefined;
			const result = await fetchKeyInfo(key, fetchFn);
			return result.ok ? toProviderUsage(result.info, now) : undefined;
		},
	};
}
