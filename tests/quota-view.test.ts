import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeyInfo, type FetchResult } from "../lib/openrouter.ts";
import { parseActivity, type ActivityResult } from "../lib/activity.ts";
import { QuotaView, type QuotaViewDeps } from "../lib/quota-view.ts";
import { ACTIVITY, SAMPLE } from "./fixtures.ts";

const NOW = Date.UTC(2025, 10, 5, 15, 30);
const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
const fit = (text: string, width: number) => (text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width));

function harness(results: FetchResult[], activity: ActivityResult[] = []) {
	const calls = { load: 0, activity: 0, close: 0, render: 0, alerts: [] as string[][] };
	let pending: ((r: FetchResult) => void) | undefined;
	let pendingActivity: ((r: ActivityResult) => void) | undefined;
	const deps: QuotaViewDeps = {
		theme, fit, now: () => NOW, threshold: 80,
		load: () => { calls.load++; const r = results.shift(); return r ? Promise.resolve(r) : new Promise((res) => (pending = res)); },
		onAlerts: (alerts) => calls.alerts.push(alerts.map((a) => a.message)),
		onClose: () => calls.close++,
		requestRender: () => calls.render++,
		loadActivity: () => { calls.activity++; const r = activity.shift(); return r ? Promise.resolve(r) : new Promise((res) => (pendingActivity = res)); },
	};
	return { view: new QuotaView(deps), calls, resolve: (r: FetchResult) => pending?.(r), resolveActivity: (r: ActivityResult) => pendingActivity?.(r) };
}
const settle = () => new Promise((r) => setImmediate(r));

test("QuotaView frames the report like the alt+u panel, with key hints", async () => {
	const { view, calls } = harness([{ ok: true, info: parseKeyInfo(SAMPLE)! }]);
	view.refresh();
	await settle();
	const lines = view.render(110);
	assert.equal(lines[0], `╭─ ✿ OpenRouter ─ Quota · Models ${"─".repeat(110 - 2 - 12 - 14 - 6)}╮`);
	assert.equal(lines[1], `│ ${fit("sk-or-v1-abc...xyz · paid", 106)} │`);
	assert.equal(lines.at(-3), `│ ${fit("Alerts at 80%", 106)} │`, "the overlay drops the redundant title and refresh hint");
	assert.equal(lines.at(-2), `│ ${fit("tab switch   r refresh   esc close", 106)} │`);
	assert.equal(lines.at(-1), `╰${"─".repeat(108)}╯`);
	for (const line of lines) assert.equal(line.length, 110);
	assert.deepEqual(calls.alerts, [["OpenRouter workspace budget at 90% ($10.00 left)"]]);
});

test("QuotaView shows loading, then errors, and r retries", async () => {
	const { view, calls, resolve } = harness([]);
	view.refresh();
	assert.match(view.render(60)[0]!, /✿ OpenRouter · refreshing…/);
	assert.match(view.render(60)[1]!, /Fetching OpenRouter quota…/);
	view.refresh();
	assert.equal(calls.load, 1, "no second fetch while one is in flight");
	resolve({ ok: false, error: "OpenRouter answered HTTP 401." });
	await settle();
	assert.match(view.render(60)[1]!, /OpenRouter answered HTTP 401\./);
	assert.doesNotMatch(view.render(60)[0]!, /refreshing/);
	assert.deepEqual(calls.alerts, []);
	view.handleInput("r");
	assert.equal(calls.load, 2);
});

test("QuotaView keeps the last report visible when a refresh fails", async () => {
	const { view } = harness([{ ok: true, info: parseKeyInfo(SAMPLE)! }, { ok: false, error: "Could not reach OpenRouter: offline" }]);
	view.refresh();
	await settle();
	view.handleInput("r");
	await settle();
	const text = view.render(110).join("\n");
	assert.match(text, /sk-or-v1-abc\.\.\.xyz/);
	assert.match(text, /Could not reach OpenRouter: offline/);
});

test("QuotaView closes on esc and q, and survives a throwing loader", async () => {
	const { view, calls } = harness([]);
	view.handleInput("\u001b");
	view.handleInput("q");
	assert.equal(calls.close, 2);
	const broken = new QuotaView({ ...harness([]).view["deps"], load: () => { throw new Error("boom"); } });
	broken.refresh();
	await settle();
	assert.match(broken.render(60)[1]!, /boom/);
});

test("QuotaView closes on the escape key in any terminal encoding the TUI reports", () => {
	const { view, calls } = harness([]);
	const kittyEscape = "\u001b[27u";
	view.handleInput(kittyEscape);
	assert.equal(calls.close, 0, "the default matcher only knows the raw byte");
	const tuiAware = new QuotaView({ ...view["deps"], isEscape: (data: string) => data === kittyEscape || data === "\u001b" });
	tuiAware.handleInput(kittyEscape);
	tuiAware.handleInput("x");
	assert.equal(calls.close, 1);
});

const ROWS = parseActivity(ACTIVITY)!;

test("QuotaView highlights the active tab in the frame title", () => {
	const tagged = { fg: (c: string, t: string) => `<${c}>${t}`, bold: (t: string) => `*${t}*` };
	const { view } = harness([]);
	const styled = new QuotaView({ ...view["deps"], theme: tagged, fit: (t: string) => t });
	assert.match(styled.render(80)[0]!, /\*<accent>Quota\*.*<muted>Models/);
	styled.handleInput("\t");
	assert.match(styled.render(80)[0]!, /<muted>Quota.*\*<accent>Models\*/);
});

test("QuotaView loads Models lazily on first tab, and tab switches back without refetching", async () => {
	const { view, calls } = harness([{ ok: true, info: parseKeyInfo(SAMPLE)! }], [{ ok: true, rows: ROWS }]);
	view.refresh();
	await settle();
	assert.equal(calls.activity, 0, "nothing fetched for Models until it opens");
	view.handleInput("\t");
	assert.equal(calls.activity, 1);
	assert.match(view.render(110)[1]!, /Fetching OpenRouter activity…/);
	await settle();
	const models = view.render(110);
	for (const line of models) assert.equal(line.length, 110);
	assert.match(models[1]!, /Spend in last 30 days {2}\$5\.80 · 53 requests/);
	assert.ok(models.some((line) => line.includes("Ranking by model")));
	assert.equal(models.at(-2), `│ ${fit("tab switch   r refresh   esc close", 106)} │`);
	view.handleInput("\t");
	assert.match(view.render(110)[1]!, /sk-or-v1-abc/);
	view.handleInput("\t");
	assert.equal(calls.activity, 1, "already loaded");
	assert.deepEqual(calls.alerts, [["OpenRouter workspace budget at 90% ($10.00 left)"]], "only quota fetches raise alerts");
});

test("QuotaView r refreshes only the active tab, each with its own loading and error state", async () => {
	const { view, calls, resolveActivity } = harness([{ ok: true, info: parseKeyInfo(SAMPLE)! }], [{ ok: true, rows: ROWS }]);
	view.refresh();
	await settle();
	view.handleInput("\t");
	await settle();
	view.handleInput("r");
	assert.equal(calls.activity, 2);
	assert.equal(calls.load, 1, "r on Models leaves the quota alone");
	assert.match(view.render(110)[0]!, /refreshing…/);
	resolveActivity({ ok: false, error: "Could not reach OpenRouter: offline" });
	await settle();
	const text = view.render(110).join("\n");
	assert.match(text, /\$5\.80/, "the last good activity stays visible");
	assert.match(text, /Could not reach OpenRouter: offline/);
	view.handleInput("\t");
	assert.doesNotMatch(view.render(110).join("\n"), /offline/, "the Quota tab has its own error state");
	view.handleInput("r");
	assert.equal(calls.load, 2);
	assert.equal(calls.activity, 2);
});

test("QuotaView explains how to set up the management key when it is missing", async () => {
	const { view, calls } = harness([], [{ ok: false, missingKey: true, error: "No OpenRouter management key. Set OPENROUTER_MANAGEMENT_KEY." }]);
	view.handleInput("\t");
	await settle();
	const text = view.render(110).join("\n");
	assert.match(text, /https:\/\/openrouter\.ai\/settings\/management-keys/);
	assert.match(text, /export OPENROUTER_MANAGEMENT_KEY=\.\.\./);
	assert.equal(calls.load, 0, "opening Models does not fetch the quota");
});

test("QuotaView switches tabs with an injected tab matcher", () => {
	const { view, calls } = harness([], [{ ok: true, rows: [] }]);
	const kittyTab = "\u001b[9u";
	const tuiAware = new QuotaView({ ...view["deps"], isTab: (data: string) => data === kittyTab });
	tuiAware.handleInput("\t");
	assert.equal(calls.activity, 0, "the injected matcher replaces the default");
	tuiAware.handleInput(kittyTab);
	assert.equal(calls.activity, 1);
});

test("QuotaView renders ledger results as local data that includes today", async () => {
	const today = { date: "2025-11-05", model: "openai/gpt-4o", permaslug: null, provider: null, usage: 0.25, byokUsage: 0, requests: 2, promptTokens: 10, completionTokens: 1, reasoningTokens: 0, cachedTokens: 0 };
	const { view } = harness([], [{ ok: true, rows: [today], source: { kind: "ledger", since: "2025-11-05", estimated: 1 } }]);
	view.handleInput("\t");
	await settle();
	const lines = view.render(110);
	for (const line of lines) assert.equal(line.length, 110);
	assert.match(lines[1]!, /Spend in last 30 days {2}\$0\.25 · 2 requests/);
	assert.match(lines[2]!, /Local: usage through Pi on this machine since Nov 5 · 1 estimated/);
	assert.match(lines.join("\n"), /openai\/gpt-4o/);
});

test("QuotaView shows the empty-ledger message instead of the missing-key error", async () => {
	const { view } = harness([], [{ ok: true, rows: [], source: { kind: "ledger", since: null, estimated: 0 } }]);
	view.handleInput("\t");
	await settle();
	const text = view.render(110).join("\n");
	assert.match(text, /No OpenRouter usage through Pi recorded on this machine yet/);
	assert.doesNotMatch(text, /No activity in the last 30 days/);
});
