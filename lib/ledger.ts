// A local ledger of OpenRouter usage made through Pi on this machine: the
// Models tab's fallback when there is no management key for /api/v1/activity.
// One JSON line per OpenRouter assistant response, appended (never rewritten on
// the hot path) by every Pi process, subagents included. It holds dates, model
// ids, costs and token counts only: no keys, prompts or message content.

import { join } from "node:path";
import * as nodeFs from "node:fs/promises";
import type { ActivityResult, ActivityRow } from "./activity.ts";
import { correctedEntry, isGenerationId, type GenerationResult } from "./generation.ts";

export const LEDGER_DIR = "openrouter-quota";
export const LEDGER_FILE = "ledger.jsonl";
export const RETENTION_DAYS = 30;
export const COMPACT_BYTES = 512 * 1024;
export const CORRECTION_DELAY_MS = 3000;
const DAY_MS = 86_400_000;

export interface LedgerEntry {
	v: 1;
	/** OpenRouter generation id, or a synthetic local id when Pi did not expose one. */
	id: string;
	/** Epoch milliseconds the request started. */
	ts: number;
	model: string;
	/** USD; Pi's catalog estimate while `estimated`, else what OpenRouter billed (BYOK: fee + upstream). */
	cost: number;
	estimated: boolean;
	/** Only present once known from /api/v1/generation. */
	byok?: boolean;
	requests: number;
	prompt: number;
	completion: number;
	reasoning: number;
	cached: number;
}

/** The fs subset the ledger uses; injectable for tests. */
export interface LedgerFs {
	mkdir(path: string, options: { recursive: true }): Promise<unknown>;
	appendFile(path: string, data: string): Promise<void>;
	readFile(path: string, encoding: "utf8"): Promise<string>;
	writeFile(path: string, data: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	stat(path: string): Promise<{ size: number }>;
}

export function ledgerPath(agentDir: string): string {
	return join(agentDir, LEDGER_DIR, LEDGER_FILE);
}

/** Start of the UTC day 29 days before today: the ledger keeps today and the 29 days before it. */
export function retentionStart(now: number): number {
	return Math.floor(now / DAY_MS) * DAY_MS - (RETENTION_DAYS - 1) * DAY_MS;
}

const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const num = (value: unknown): number => (isNum(value) ? value : 0);
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The ledger line for one Pi message, or undefined when it is not a billable OpenRouter response. */
export function buildEntry(message: unknown, fallbackId: () => string): LedgerEntry | undefined {
	if (!message || typeof message !== "object") return undefined;
	const m = message as Record<string, unknown>;
	if (m.role !== "assistant" || m.provider !== "openrouter" || typeof m.model !== "string") return undefined;
	const usage = m.usage as Record<string, unknown> | null | undefined;
	if (!usage || typeof usage !== "object") return undefined;
	const cost = (usage.cost ?? {}) as Record<string, unknown>;
	const prompt = num(usage.input) + num(usage.cacheRead) + num(usage.cacheWrite);
	const completion = num(usage.output);
	if ((m.stopReason === "error" || m.stopReason === "aborted") && prompt + completion === 0) return undefined;
	return {
		v: 1,
		// Only url-safe OpenRouter ids are kept; anything else gets a synthetic local id.
		id: isGenerationId(m.responseId) ? m.responseId : fallbackId(),
		ts: isNum(m.timestamp) ? m.timestamp : Date.now(),
		model: typeof m.responseModel === "string" && m.responseModel ? m.responseModel : m.model,
		cost: num(cost.total),
		estimated: cost.totalFromProvider !== true,
		requests: 1,
		prompt,
		completion,
		reasoning: num(usage.reasoning),
		cached: num(usage.cacheRead),
	};
}

function parseLine(text: string): LedgerEntry | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!raw || typeof raw !== "object") return undefined;
	const e = raw as Record<string, unknown>;
	if (e.v !== 1 || typeof e.id !== "string" || typeof e.model !== "string" || typeof e.estimated !== "boolean") return undefined;
	if (e.byok !== undefined && typeof e.byok !== "boolean") return undefined;
	for (const key of ["ts", "cost", "requests", "prompt", "completion", "reasoning", "cached"]) if (!isNum(e[key])) return undefined;
	const entry: LedgerEntry = {
		v: 1, id: e.id, ts: e.ts as number, model: e.model, cost: e.cost as number, estimated: e.estimated,
		requests: e.requests as number, prompt: e.prompt as number, completion: e.completion as number,
		reasoning: e.reasoning as number, cached: e.cached as number,
	};
	if (typeof e.byok === "boolean") entry.byok = e.byok;
	return entry;
}

/** Skips corrupt or torn lines, keeps the last line per id (corrections), and drops entries past retention. */
export function parseLedger(text: string, now: number): LedgerEntry[] {
	const start = retentionStart(now);
	const byId = new Map<string, LedgerEntry>();
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		const entry = parseLine(line);
		if (entry) byId.set(entry.id, entry);
	}
	return [...byId.values()].filter((entry) => entry.ts >= start);
}

const NODE_FS: LedgerFs = {
	mkdir: (path, options) => nodeFs.mkdir(path, options),
	appendFile: (path, data) => nodeFs.appendFile(path, data, "utf8"),
	readFile: (path, encoding) => nodeFs.readFile(path, encoding),
	writeFile: (path, data) => nodeFs.writeFile(path, data, "utf8"),
	rename: (from, to) => nodeFs.rename(from, to),
	stat: (path) => nodeFs.stat(path),
};

const serialize = (entries: LedgerEntry[]): string => entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");

export class Ledger {
	private readonly path: string;
	private readonly fs: LedgerFs;
	private readonly now: () => number;

	constructor(options: { path: string; fs?: LedgerFs; now?: () => number }) {
		this.path = options.path;
		this.fs = options.fs ?? NODE_FS;
		this.now = options.now ?? Date.now;
	}

	/** One small O_APPEND write; never rejects, recording must not break a turn. */
	async append(entry: LedgerEntry): Promise<void> {
		try {
			await this.fs.mkdir(join(this.path, ".."), { recursive: true });
			await this.fs.appendFile(this.path, serialize([entry]));
		} catch {
			// Swallowed on purpose.
		}
	}

	async read(): Promise<LedgerEntry[]> {
		try {
			return parseLedger(await this.fs.readFile(this.path, "utf8"), this.now());
		} catch {
			return [];
		}
	}

	/** Past COMPACT_BYTES, rewrite the retained entries via a temp file and rename. Never rejects. */
	async compact(): Promise<void> {
		try {
			const { size } = await this.fs.stat(this.path);
			if (size <= COMPACT_BYTES) return;
			const entries = parseLedger(await this.fs.readFile(this.path, "utf8"), this.now());
			const temp = `${this.path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
			await this.fs.writeFile(temp, serialize(entries));
			await this.fs.rename(temp, this.path);
		} catch {
			// Swallowed on purpose; the ledger stays as it was.
		}
	}
}

/** Activity-shaped rows per UTC day and model, so the Models tab renders the ledger like /activity. */
export function ledgerActivity(entries: LedgerEntry[]): { rows: ActivityRow[]; since: string | null; estimated: number } {
	const rows = new Map<string, ActivityRow>();
	let since: string | null = null;
	let estimated = 0;
	for (const entry of entries) {
		const date = isoDay(entry.ts);
		if (since === null || date < since) since = date;
		if (entry.estimated) estimated++;
		const key = `${date}\u0000${entry.model}`;
		let row = rows.get(key);
		if (!row) {
			row = { date, model: entry.model, permaslug: null, provider: null, usage: 0, byokUsage: 0, requests: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
			rows.set(key, row);
		}
		// The ledger keeps one BYOK cost (fee + upstream); it all counts as BYOK spend.
		if (entry.byok) row.byokUsage += entry.cost;
		else row.usage += entry.cost;
		row.requests += entry.requests;
		row.promptTokens += entry.prompt;
		row.completionTokens += entry.completion;
		row.reasoningTokens += entry.reasoning;
		row.cachedTokens += entry.cached;
	}
	return { rows: [...rows.values()], since, estimated };
}

/** S13: account-wide /activity with a management key (errors included); otherwise the local ledger. */
export async function loadModelsActivity(deps: {
	managementKey: string | undefined;
	fetchActivity(key: string): Promise<ActivityResult>;
	readLedger(): Promise<LedgerEntry[]>;
}): Promise<ActivityResult> {
	const key = deps.managementKey?.trim();
	if (key) return deps.fetchActivity(key);
	const { rows, since, estimated } = ledgerActivity(await deps.readLedger());
	return { ok: true, rows, source: { kind: "ledger", since, estimated } };
}

export interface RecorderDeps {
	append(entry: LedgerEntry): Promise<void>;
	/** One attempt at the billed cost of a real generation id. */
	fetchGeneration(id: string): Promise<GenerationResult>;
	setTimer(fn: () => void, ms: number): void;
	fallbackId(): string;
	delayMs?: number;
}

/**
 * `message_end` handler body: records OpenRouter responses and, for estimated
 * costs with a real generation id, appends one correction ~3s later (stats lag).
 * Never throws and never leaves a rejection unhandled.
 */
export function createRecorder(deps: RecorderDeps): (message: unknown) => void {
	return (message) => {
		let recorded: LedgerEntry | undefined;
		try {
			recorded = buildEntry(message, deps.fallbackId);
		} catch {
			return;
		}
		if (!recorded) return;
		const entry = recorded;
		void deps.append(entry).catch(() => undefined);
		// Synthetic ids are never sent to OpenRouter: only the message's own valid generation id.
		const realId = entry.id === (message as { responseId?: unknown }).responseId;
		if (!entry.estimated || !realId) return;
		deps.setTimer(() => {
			try {
				deps.fetchGeneration(entry.id).then(
					(result) => (result.ok ? deps.append(correctedEntry(entry, result.generation)) : undefined),
					() => undefined,
				).catch(() => undefined);
			} catch {
				// A throwing fetcher leaves the estimate.
			}
		}, deps.delayMs ?? CORRECTION_DELAY_MS);
	};
}
