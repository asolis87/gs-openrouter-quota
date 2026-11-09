// OpenRouter key information: one GET to /api/v1/key, parsed defensively into
// a small model the alt+u source and the /openrouter command both render.
// Nothing here keeps the API key or touches global state.

export const OPENROUTER_PROVIDER = "openrouter";
export const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
export const OPENROUTER_ENV_KEY = "OPENROUTER_API_KEY";

export type ResetInterval = "daily" | "weekly" | "monthly";

export interface Budget {
	scope: string;
	limitUsd: number;
	spendUsd: number;
	remainingUsd: number;
	resetInterval: ResetInterval | null;
	/** Epoch milliseconds, or null when the window never resets. */
	resetsAt: number | null;
	includeByok: boolean;
}

export interface UsageTotals {
	total: number;
	daily: number | null;
	weekly: number | null;
	monthly: number | null;
}

export interface KeyLimit {
	limit: number;
	remaining: number;
	reset: string | null;
	includeByok: boolean;
}

export interface FreeRequests {
	used: number;
	limit: number;
	remaining: number;
}

export interface KeyInfo {
	label: string;
	isFreeTier: boolean;
	/** null when the key has no credit limit. */
	keyLimit: KeyLimit | null;
	budgets: Budget[];
	effectiveBudget: Budget | null;
	usage: UsageTotals;
	byokUsage: UsageTotals | null;
	freeRequests: FreeRequests | null;
}

export type FetchResult = { ok: true; info: KeyInfo } | { ok: false; error: string };

const RESET_INTERVALS: readonly string[] = ["daily", "weekly", "monthly"];
const INVALID = Symbol("invalid");

function isNum(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function optNum(value: unknown): number | null | typeof INVALID {
	if (value === undefined || value === null) return null;
	return isNum(value) ? value : INVALID;
}

function parseBudget(value: unknown): Budget | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	if (typeof raw.scope !== "string" || !isNum(raw.limit_usd) || !isNum(raw.spend_usd)) return undefined;
	const remaining = raw.remaining_usd === undefined ? raw.limit_usd - raw.spend_usd : raw.remaining_usd;
	if (!isNum(remaining)) return undefined;
	const interval = raw.reset_interval;
	if (interval !== null && interval !== undefined && !(typeof interval === "string" && RESET_INTERVALS.includes(interval))) return undefined;
	let resetsAt: number | null = null;
	if (typeof raw.resets_at === "string") {
		const parsed = Date.parse(raw.resets_at);
		resetsAt = Number.isFinite(parsed) ? parsed : null;
	}
	return {
		scope: raw.scope,
		limitUsd: raw.limit_usd,
		spendUsd: raw.spend_usd,
		remainingUsd: remaining,
		resetInterval: (interval ?? null) as ResetInterval | null,
		resetsAt,
		includeByok: raw.include_byok === true,
	};
}

function parseTotals(raw: Record<string, unknown>, prefix: string): UsageTotals | null | typeof INVALID {
	const total = raw[prefix];
	if (total === undefined || total === null) return null;
	if (!isNum(total)) return INVALID;
	const daily = optNum(raw[`${prefix}_daily`]);
	const weekly = optNum(raw[`${prefix}_weekly`]);
	const monthly = optNum(raw[`${prefix}_monthly`]);
	if (daily === INVALID || weekly === INVALID || monthly === INVALID) return INVALID;
	return { total, daily, weekly, monthly };
}

export function parseKeyInfo(payload: unknown): KeyInfo | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const data = (payload as Record<string, unknown>).data;
	if (!data || typeof data !== "object") return undefined;
	const raw = data as Record<string, unknown>;

	const usage = parseTotals(raw, "usage");
	if (usage === null || usage === INVALID) return undefined;
	const byokUsage = parseTotals(raw, "byok_usage");
	if (byokUsage === INVALID) return undefined;

	let keyLimit: KeyLimit | null = null;
	if (raw.limit !== null && raw.limit !== undefined) {
		if (!isNum(raw.limit)) return undefined;
		const remaining = isNum(raw.limit_remaining) ? raw.limit_remaining : raw.limit - usage.total;
		keyLimit = {
			limit: raw.limit,
			remaining,
			reset: typeof raw.limit_reset === "string" ? raw.limit_reset : null,
			includeByok: raw.include_byok_in_limit === true,
		};
	}

	const budgets: Budget[] = [];
	if (raw.budgets !== undefined && raw.budgets !== null) {
		if (!Array.isArray(raw.budgets)) return undefined;
		for (const entry of raw.budgets) {
			const budget = parseBudget(entry);
			if (!budget) return undefined;
			budgets.push(budget);
		}
	}
	const effectiveBudget = raw.effective_budget ? (parseBudget(raw.effective_budget) ?? null) : null;

	let freeRequests: FreeRequests | null = null;
	const free = raw.free_model_daily_requests as Record<string, unknown> | null | undefined;
	if (free && typeof free === "object" && isNum(free.used) && isNum(free.limit)) {
		freeRequests = { used: free.used, limit: free.limit, remaining: isNum(free.remaining) ? free.remaining : free.limit - free.used };
	}

	return {
		label: typeof raw.label === "string" ? raw.label : "",
		isFreeTier: raw.is_free_tier === true,
		keyLimit,
		budgets,
		effectiveBudget,
		usage,
		byokUsage,
		freeRequests,
	};
}

export async function fetchKeyInfo(apiKey: string | undefined, fetchFn: typeof fetch): Promise<FetchResult> {
	if (!apiKey) return { ok: false, error: `No OpenRouter API key. Run /login openrouter or set ${OPENROUTER_ENV_KEY}.` };
	let response: Response;
	try {
		response = await fetchFn(OPENROUTER_KEY_URL, {
			method: "GET",
			headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
			redirect: "error",
			cache: "no-store",
		});
	} catch (error) {
		return { ok: false, error: `Could not reach OpenRouter: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (!response.ok) return { ok: false, error: `OpenRouter answered HTTP ${response.status}.` };
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		payload = undefined;
	}
	const info = parseKeyInfo(payload);
	return info ? { ok: true, info } : { ok: false, error: "OpenRouter returned an unexpected payload." };
}

export interface ApiKeyRegistry {
	getApiKeyForProvider(provider: string): Promise<string | undefined>;
}

/** Pi's own OpenRouter credential first, then OPENROUTER_API_KEY. Blank values count as missing. */
export async function resolveApiKey(registry: ApiKeyRegistry | undefined, env: Record<string, string | undefined>): Promise<string | undefined> {
	const fromPi = registry ? await registry.getApiKeyForProvider(OPENROUTER_PROVIDER).catch(() => undefined) : undefined;
	if (fromPi && fromPi.trim()) return fromPi.trim();
	const fromEnv = env[OPENROUTER_ENV_KEY];
	return fromEnv && fromEnv.trim() ? fromEnv.trim() : undefined;
}
