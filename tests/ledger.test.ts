import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantMessage } from "./fixtures.ts";
import {
	buildEntry, COMPACT_BYTES, createRecorder, Ledger, ledgerActivity, ledgerPath, loadModelsActivity, parseLedger, retentionStart,
	type LedgerEntry, type LedgerFs,
} from "../lib/ledger.ts";
import type { ActivityResult } from "../lib/activity.ts";
import type { GenerationResult } from "../lib/generation.ts";

const NOW = Date.UTC(2025, 10, 5, 15, 30);
const DAY = 86_400_000;
const settle = () => new Promise((r) => setImmediate(r));

const entry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
	v: 1, id: "gen-1", ts: NOW - 3_600_000, model: "anthropic/claude-sonnet-4", cost: 0.5, estimated: false,
	requests: 1, prompt: 1000, completion: 100, reasoning: 0, cached: 0, ...overrides,
});
const line = (e: unknown) => `${JSON.stringify(e)}\n`;

/** An in-memory fs with the subset Ledger uses; `fail` makes the named method throw. */
function memoryFs(initial: Record<string, string> = {}, fail: string[] = []) {
	const files = new Map(Object.entries(initial));
	const calls: string[] = [];
	const guard = (name: string) => {
		calls.push(name);
		if (fail.includes(name)) throw Object.assign(new Error(`${name} failed`), { code: "EACCES" });
	};
	const fs: LedgerFs = {
		mkdir: async () => { guard("mkdir"); return undefined; },
		appendFile: async (path, data) => { guard("appendFile"); files.set(path, (files.get(path) ?? "") + data); },
		readFile: async (path) => {
			guard("readFile");
			const text = files.get(path);
			if (text === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			return text;
		},
		writeFile: async (path, data) => { guard("writeFile"); files.set(path, data); },
		rename: async (from, to) => {
			guard("rename");
			files.set(to, files.get(from) ?? "");
			files.delete(from);
		},
		stat: async (path) => {
			guard("stat");
			const text = files.get(path);
			if (text === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			return { size: Buffer.byteLength(text) };
		},
	};
	return { fs, files, calls };
}

test("ledgerPath lives under the agent dir", () => {
	assert.equal(ledgerPath("/home/u/.pi/agent"), "/home/u/.pi/agent/openrouter-quota/ledger.jsonl");
});

test("buildEntry maps an OpenRouter assistant message and stores no content", () => {
	const e = buildEntry(assistantMessage(), () => "local-x");
	assert.deepEqual(e, {
		v: 1, id: "gen-1730800000-abcDEF123", ts: Date.UTC(2025, 10, 5, 12, 0), model: "anthropic/claude-4-sonnet-20250522",
		cost: 0.0063, estimated: false, requests: 1, prompt: 1350, completion: 200, reasoning: 40, cached: 300,
	});
	assert.doesNotMatch(JSON.stringify(e), /SECRET/);
	assert.equal("byok" in e!, false, "BYOK is unknown until /generation says so");
});

test("buildEntry falls back to model, synthetic ids, estimates and missing reasoning", () => {
	const e = buildEntry(assistantMessage({ responseModel: undefined, responseId: undefined }, { reasoning: undefined }, { totalFromProvider: undefined }), () => "local-x");
	assert.equal(e?.id, "local-x");
	assert.equal(e?.model, "anthropic/claude-sonnet-4");
	assert.equal(e?.estimated, true);
	assert.equal(e?.reasoning, 0);
});

test("buildEntry skips other providers, other roles, malformed messages and empty failed responses", () => {
	const id = () => "local-x";
	assert.equal(buildEntry(assistantMessage({ provider: "anthropic" }), id), undefined);
	assert.equal(buildEntry({ role: "user", content: "hi", timestamp: NOW }, id), undefined);
	assert.equal(buildEntry(null, id), undefined);
	assert.equal(buildEntry(assistantMessage({ usage: null }), id), undefined);
	const empty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 };
	for (const stopReason of ["error", "aborted"]) {
		assert.equal(buildEntry(assistantMessage({ stopReason }, empty, { total: 0 }), id), undefined, stopReason);
		assert.ok(buildEntry(assistantMessage({ stopReason }), id), `${stopReason} with tokens is still billed`);
	}
});

test("parseLedger skips corrupt lines, lets the last line per id win and prunes past 30 days", () => {
	const start = retentionStart(NOW);
	assert.equal(start, Date.UTC(2025, 9, 7), "today and the 29 days before it");
	const text = [
		line(entry({ id: "a", cost: 0.1, estimated: true })),
		"{not json\n",
		line({ v: 2, id: "future-format" }),
		line(entry({ id: "b", ts: start - 1 })),
		line(entry({ id: "c", ts: start })),
		line({ ...entry({ id: "d" }), cost: "1" }),
		line(entry({ id: "a", cost: 0.12, estimated: false, byok: true })),
		'{"v":1,"id":"partial"', // a torn last line
	].join("");
	const entries = parseLedger(text, NOW);
	assert.deepEqual(entries.map((e) => e.id), ["a", "c"]);
	assert.equal(entries[0]!.cost, 0.12);
	assert.equal(entries[0]!.byok, true);
	assert.equal(entries[0]!.estimated, false);
});

test("Ledger.append writes one line with mkdir -p and reads it back", async () => {
	const { fs, files, calls } = memoryFs();
	const ledger = new Ledger({ path: "/d/ledger.jsonl", fs, now: () => NOW });
	await ledger.append(entry({ id: "a" }));
	await ledger.append(entry({ id: "b" }));
	assert.deepEqual(calls.filter((c) => c !== "mkdir"), ["appendFile", "appendFile"]);
	assert.equal(files.get("/d/ledger.jsonl")!.split("\n").length, 3);
	assert.deepEqual((await ledger.read()).map((e) => e.id), ["a", "b"]);
});

test("Ledger swallows fs failures: append never rejects, read returns nothing", async () => {
	for (const fail of [["appendFile"], ["mkdir"]]) {
		const { fs } = memoryFs({}, fail);
		await new Ledger({ path: "/d/ledger.jsonl", fs, now: () => NOW }).append(entry());
	}
	const { fs } = memoryFs({}, ["readFile"]);
	assert.deepEqual(await new Ledger({ path: "/d/ledger.jsonl", fs, now: () => NOW }).read(), []);
	assert.deepEqual(await new Ledger({ path: "/missing", fs: memoryFs().fs, now: () => NOW }).read(), []);
});

test("Ledger.compact rewrites only past the size threshold, via temp file and rename, keeping 30 days", async () => {
	const old = line(entry({ id: "old", ts: NOW - 40 * DAY }));
	const keep = line(entry({ id: "keep" }));
	const small = memoryFs({ "/d/ledger.jsonl": old + keep });
	await new Ledger({ path: "/d/ledger.jsonl", fs: small.fs, now: () => NOW }).compact();
	assert.deepEqual(small.calls, ["stat"], "small files are left alone");

	const padding = old.repeat(Math.ceil(COMPACT_BYTES / old.length) + 1);
	const big = memoryFs({ "/d/ledger.jsonl": padding + keep + keep });
	await new Ledger({ path: "/d/ledger.jsonl", fs: big.fs, now: () => NOW }).compact();
	assert.deepEqual(big.calls, ["stat", "readFile", "writeFile", "rename"]);
	assert.equal(big.files.get("/d/ledger.jsonl"), keep, "pruned and deduped");
	assert.equal([...big.files.keys()].length, 1, "the temp file was renamed over the ledger");

	const broken = memoryFs({ "/d/ledger.jsonl": padding + keep }, ["rename"]);
	await new Ledger({ path: "/d/ledger.jsonl", fs: broken.fs, now: () => NOW }).compact();
	assert.equal(broken.files.get("/d/ledger.jsonl"), padding + keep, "a failed rename leaves the ledger intact");
});

test("ledgerActivity aggregates per UTC day and model, with BYOK, since and estimated count", () => {
	const day = (d: number, h = 12) => Date.UTC(2025, 10, d, h);
	const result = ledgerActivity([
		entry({ id: "1", ts: day(5, 1), cost: 0.5, prompt: 100, completion: 10, reasoning: 5, cached: 50 }),
		entry({ id: "2", ts: day(5, 23), cost: 0.25, estimated: true, prompt: 200, completion: 20, reasoning: 0, cached: 0 }),
		entry({ id: "3", ts: day(3), model: "openai/gpt-4o", cost: 1, byok: true }),
		entry({ id: "4", ts: day(1), model: "openai/gpt-4o", cost: 0.1 }),
	]);
	assert.equal(result.since, "2025-11-01");
	assert.equal(result.estimated, 1);
	const claude = result.rows.find((r) => r.model === "anthropic/claude-sonnet-4" && r.date === "2025-11-05");
	assert.deepEqual(claude, {
		date: "2025-11-05", model: "anthropic/claude-sonnet-4", permaslug: null, provider: null,
		usage: 0.75, byokUsage: 0, requests: 2, promptTokens: 300, completionTokens: 30, reasoningTokens: 5, cachedTokens: 50,
	});
	const byok = result.rows.find((r) => r.date === "2025-11-03");
	assert.equal(byok?.usage, 0);
	assert.equal(byok?.byokUsage, 1, "BYOK spend is counted and marks the model");
	assert.equal(result.rows.length, 3);
	assert.deepEqual(ledgerActivity([]), { rows: [], since: null, estimated: 0 });
});

test("loadModelsActivity uses /activity with a management key and the ledger without one", async () => {
	const seen: string[] = [];
	const fetchActivity = async (key: string): Promise<ActivityResult> => { seen.push(key); return { ok: false, error: "OpenRouter answered HTTP 500." }; };
	const readLedger = async () => { seen.push("ledger"); return [entry({ id: "a", estimated: true })]; };
	assert.deepEqual(await loadModelsActivity({ managementKey: " mgmt ", fetchActivity, readLedger }), { ok: false, error: "OpenRouter answered HTTP 500." });
	assert.deepEqual(seen, ["mgmt"], "activity errors are not masked by the ledger");
	for (const managementKey of [undefined, "", "  "]) {
		const result = await loadModelsActivity({ managementKey, fetchActivity, readLedger });
		assert.equal(result.ok, true);
		assert.deepEqual(result.ok && result.source, { kind: "ledger", since: "2025-11-05", estimated: 1 });
		assert.equal(result.ok && result.rows.length, 1);
	}
	assert.deepEqual(seen, ["mgmt", "ledger", "ledger", "ledger"]);
	const empty = await loadModelsActivity({ managementKey: undefined, fetchActivity, readLedger: async () => [] });
	assert.deepEqual(empty, { ok: true, rows: [], source: { kind: "ledger", since: null, estimated: 0 } });
});

function recorderHarness(generation: GenerationResult | (() => Promise<GenerationResult>)) {
	const appended: LedgerEntry[] = [];
	const timers: { fn: () => void; ms: number }[] = [];
	const fetched: string[] = [];
	const record = createRecorder({
		append: async (e) => { appended.push(e); },
		fetchGeneration: (id) => { fetched.push(id); return typeof generation === "function" ? generation() : Promise.resolve(generation); },
		setTimer: (fn, ms) => { timers.push({ fn, ms }); },
		fallbackId: () => "local-1",
	});
	return { record, appended, timers, fetched };
}

test("createRecorder appends exact entries and schedules nothing for them", async () => {
	const h = recorderHarness({ ok: false, error: "unused" });
	h.record(assistantMessage());
	h.record(assistantMessage({ provider: "anthropic" }));
	await settle();
	assert.equal(h.appended.length, 1);
	assert.equal(h.timers.length, 0);
});

test("createRecorder corrects an estimated entry once, about 3s later, appending the same id", async () => {
	const h = recorderHarness({ ok: true, generation: { id: "gen-1730800000-abcDEF123", totalCost: 0.0004, isByok: true, upstreamCost: 0.008 } });
	h.record(assistantMessage({}, {}, { totalFromProvider: false }));
	await settle();
	assert.equal(h.appended.length, 1);
	assert.equal(h.appended[0]!.estimated, true);
	assert.equal(h.timers.length, 1);
	assert.equal(h.timers[0]!.ms, 3000);
	assert.deepEqual(h.fetched, [], "not before the delay");
	h.timers[0]!.fn();
	await settle();
	assert.deepEqual(h.fetched, ["gen-1730800000-abcDEF123"]);
	assert.equal(h.appended.length, 2);
	assert.equal(h.appended[1]!.id, h.appended[0]!.id);
	assert.equal(h.appended[1]!.estimated, false);
	assert.equal(h.appended[1]!.byok, true);
	assert.ok(Math.abs(h.appended[1]!.cost - 0.0084) < 1e-12, "BYOK cost is the fee plus upstream inference");
	assert.equal(h.timers.length, 1, "one attempt, no retries");
});

test("createRecorder leaves the estimate on failure and never fetches synthetic ids", async () => {
	for (const generation of [{ ok: false as const, error: "HTTP 404" }, () => Promise.reject(new Error("offline"))]) {
		const h = recorderHarness(generation);
		h.record(assistantMessage({}, {}, { totalFromProvider: false }));
		h.timers[0]!.fn();
		await settle();
		assert.equal(h.appended.length, 1);
		assert.equal(h.timers.length, 1);
	}
	const h = recorderHarness({ ok: false, error: "unused" });
	h.record(assistantMessage({ responseId: undefined }, {}, { totalFromProvider: false }));
	h.record(assistantMessage({ responseId: "../../etc" }, {}, { totalFromProvider: false }));
	await settle();
	assert.deepEqual(h.appended.map((e) => e.id), ["local-1", "local-1"]);
	assert.equal(h.timers.length, 0);
});
