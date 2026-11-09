import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeyInfo, type FetchResult } from "../lib/openrouter.ts";
import { QuotaView, type QuotaViewDeps } from "../lib/quota-view.ts";
import { SAMPLE } from "./fixtures.ts";

const NOW = Date.UTC(2025, 10, 5, 15, 30);
const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
const fit = (text: string, width: number) => (text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width));

function harness(results: FetchResult[]) {
	const calls = { load: 0, close: 0, render: 0, alerts: [] as string[][] };
	let pending: ((r: FetchResult) => void) | undefined;
	const deps: QuotaViewDeps = {
		theme, fit, now: () => NOW, threshold: 80,
		load: () => { calls.load++; const r = results.shift(); return r ? Promise.resolve(r) : new Promise((res) => (pending = res)); },
		onAlerts: (alerts) => calls.alerts.push(alerts.map((a) => a.message)),
		onClose: () => calls.close++,
		requestRender: () => calls.render++,
	};
	return { view: new QuotaView(deps), calls, resolve: (r: FetchResult) => pending?.(r) };
}
const settle = () => new Promise((r) => setImmediate(r));

test("QuotaView frames the report like the alt+u panel, with key hints", async () => {
	const { view, calls } = harness([{ ok: true, info: parseKeyInfo(SAMPLE)! }]);
	view.refresh();
	await settle();
	const lines = view.render(110);
	assert.equal(lines[0], `╭─ ✿ OpenRouter ${"─".repeat(110 - 2 - 14 - 1)}╮`);
	assert.equal(lines[1], `│ ${fit("sk-or-v1-abc...xyz · paid", 106)} │`);
	assert.equal(lines.at(-3), `│ ${fit("Alerts at 80%", 106)} │`, "the overlay drops the redundant title and refresh hint");
	assert.equal(lines.at(-2), `│ ${fit("r refresh   esc close", 106)} │`);
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
