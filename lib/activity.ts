// OpenRouter activity: one GET to /api/v1/activity (the last 30 completed UTC
// days, one row per date/model/endpoint). It needs a management key, which can
// manage API keys, so this module only ever sends it to that single read-only
// endpoint and never keeps it.

export const OPENROUTER_ACTIVITY_URL = "https://openrouter.ai/api/v1/activity";
export const MANAGEMENT_ENV_KEY = "OPENROUTER_MANAGEMENT_KEY";

export interface ActivityRow {
	/** UTC day, YYYY-MM-DD. */
	date: string;
	model: string;
	permaslug: string | null;
	provider: string | null;
	usage: number;
	byokUsage: number;
	requests: number;
	promptTokens: number;
	completionTokens: number;
	reasoningTokens: number;
	cachedTokens: number;
}

/** Where Models rows came from when not /activity: the local ledger of usage through Pi. */
export interface LedgerSource {
	kind: "ledger";
	/** First recorded UTC day in the window, YYYY-MM-DD, or null when nothing was recorded. */
	since: string | null;
	/** Entries whose cost is still Pi's catalog estimate. */
	estimated: number;
}

/** `source` is absent for account-wide /activity rows. */
export type ActivityResult = { ok: true; rows: ActivityRow[]; source?: LedgerSource } | { ok: false; error: string; missingKey?: true };

const DATE = /^(\d{4}-\d{2}-\d{2})(?:$|[ T])/;
const INVALID = Symbol("invalid");

function isNum(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function optNum(value: unknown): number | typeof INVALID {
	if (value === undefined || value === null) return 0;
	return isNum(value) ? value : INVALID;
}

function parseRow(value: unknown): ActivityRow | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const date = typeof raw.date === "string" ? DATE.exec(raw.date)?.[1] : undefined;
	if (!date || typeof raw.model !== "string") return undefined;
	if (!isNum(raw.usage) || !isNum(raw.requests) || !isNum(raw.prompt_tokens) || !isNum(raw.completion_tokens)) return undefined;
	const byokUsage = optNum(raw.byok_usage_inference);
	const reasoningTokens = optNum(raw.reasoning_tokens);
	const cachedTokens = optNum(raw.cached_tokens);
	if (byokUsage === INVALID || reasoningTokens === INVALID || cachedTokens === INVALID) return undefined;
	return {
		date,
		model: raw.model,
		permaslug: typeof raw.model_permaslug === "string" ? raw.model_permaslug : null,
		provider: typeof raw.provider_name === "string" ? raw.provider_name : null,
		usage: raw.usage,
		byokUsage,
		requests: raw.requests,
		promptTokens: raw.prompt_tokens,
		completionTokens: raw.completion_tokens,
		reasoningTokens,
		cachedTokens,
	};
}

export function parseActivity(payload: unknown): ActivityRow[] | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const data = (payload as Record<string, unknown>).data;
	if (!Array.isArray(data)) return undefined;
	const rows: ActivityRow[] = [];
	for (const entry of data) {
		const row = parseRow(entry);
		if (!row) return undefined;
		rows.push(row);
	}
	return rows;
}

export async function fetchActivity(managementKey: string | undefined, fetchFn: typeof fetch): Promise<ActivityResult> {
	const key = managementKey?.trim();
	if (!key) return { ok: false, missingKey: true, error: `No OpenRouter management key. Set ${MANAGEMENT_ENV_KEY}.` };
	let response: Response;
	try {
		response = await fetchFn(OPENROUTER_ACTIVITY_URL, {
			method: "GET",
			headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
			redirect: "error",
			cache: "no-store",
		});
	} catch (error) {
		return { ok: false, error: `Could not reach OpenRouter: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (response.status === 401 || response.status === 403) {
		return { ok: false, error: `OpenRouter answered HTTP ${response.status}. /api/v1/activity needs a management key, not an inference API key.` };
	}
	if (!response.ok) return { ok: false, error: `OpenRouter answered HTTP ${response.status}.` };
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		payload = undefined;
	}
	const rows = parseActivity(payload);
	return rows ? { ok: true, rows } : { ok: false, error: "OpenRouter returned an unexpected payload." };
}
