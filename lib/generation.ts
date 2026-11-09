// OpenRouter generation stats: one GET to /api/v1/generation?id=<gen id> with
// the inference key, used only to replace Pi's catalog estimate in the local
// ledger with the billed cost (and learn whether the request was BYOK).

import type { LedgerEntry } from "./ledger.ts";

export const GENERATION_URL = "https://openrouter.ai/api/v1/generation";
const GENERATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface Generation {
	id: string;
	/** What OpenRouter billed; for BYOK requests this is only its fee. */
	totalCost: number;
	isByok: boolean;
	/** The upstream provider's cost for BYOK requests, 0 otherwise. */
	upstreamCost: number;
	model?: string;
}

export type GenerationResult = { ok: true; generation: Generation } | { ok: false; error: string };

const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function isGenerationId(value: unknown): value is string {
	return typeof value === "string" && GENERATION_ID.test(value);
}

export function parseGeneration(payload: unknown): Generation | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const data = (payload as Record<string, unknown>).data;
	if (!data || typeof data !== "object") return undefined;
	const raw = data as Record<string, unknown>;
	if (typeof raw.id !== "string" || !isNum(raw.total_cost)) return undefined;
	const upstream = raw.upstream_inference_cost;
	if (upstream !== undefined && upstream !== null && !isNum(upstream)) return undefined;
	return {
		id: raw.id,
		totalCost: raw.total_cost,
		isByok: raw.is_byok === true,
		upstreamCost: isNum(upstream) ? upstream : 0,
		model: typeof raw.model === "string" ? raw.model : undefined,
	};
}

/**
 * The fetch allowlist check: exactly GENERATION_URL with a single valid `id`
 * query parameter. Returns the URL rebuilt from the validated id, never the input.
 */
export function allowedGenerationUrl(input: string): string | undefined {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		return undefined;
	}
	if (`${url.origin}${url.pathname}` !== GENERATION_URL || url.username || url.password || url.hash) return undefined;
	const keys = [...url.searchParams.keys()];
	const id = url.searchParams.get("id");
	if (keys.length !== 1 || keys[0] !== "id" || !isGenerationId(id)) return undefined;
	return `${GENERATION_URL}?id=${encodeURIComponent(id)}`;
}

export async function fetchGeneration(id: string, inferenceKey: string | undefined, fetchFn: typeof fetch): Promise<GenerationResult> {
	if (!isGenerationId(id)) return { ok: false, error: "Invalid generation id." };
	const key = inferenceKey?.trim();
	if (!key) return { ok: false, error: "No OpenRouter API key." };
	let response: Response;
	try {
		response = await fetchFn(`${GENERATION_URL}?id=${encodeURIComponent(id)}`, {
			method: "GET",
			headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
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
	const generation = parseGeneration(payload);
	return generation ? { ok: true, generation } : { ok: false, error: "OpenRouter returned an unexpected payload." };
}

/** The correction line: same id, so it replaces the estimate when the ledger is read. */
export function correctedEntry(entry: LedgerEntry, generation: Generation): LedgerEntry {
	const cost = generation.isByok ? generation.totalCost + generation.upstreamCost : generation.totalCost;
	return { ...entry, cost, estimated: false, byok: generation.isByok };
}
