import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY } from "./fixtures.ts";
import { parseActivity } from "../lib/activity.ts";
import { formatCount, renderChart, renderMissingKey, renderModels, summarizeActivity } from "../lib/models-report.ts";

const NOW = Date.UTC(2025, 10, 5, 15, 30);
const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
const summary = () => summarizeActivity(parseActivity(ACTIVITY)!, NOW);

test("summarizeActivity aggregates per model with BYOK spend, an other bucket and totals", () => {
	const s = summary();
	assert.equal(s.days.length, 30);
	assert.equal(s.days[0], "2025-10-06");
	assert.equal(s.days.at(-1), "2025-11-04", "the window ends at the last completed UTC day");
	assert.deepEqual(s.series.map((x) => x.name), ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.5-pro", "deepseek/deepseek-chat", "meta-llama/llama-3.3-70b", "other (2 models)"]);
	assert.deepEqual(s.series.map((x) => x.byok), [false, true, false, false, false, false]);
	assert.equal(s.series[0]!.stat.spend, 3);
	assert.equal(s.series[0]!.stat.requests, 15);
	assert.equal(s.series[0]!.stat.promptTokens, 1_200_000);
	assert.equal(s.series[1]!.stat.spend, 1, "spend includes BYOK inference");
	assert.equal(s.series[1]!.stat.byok, 0.5);
	assert.ok(Math.abs(s.series[5]!.stat.spend - 0.3) < 1e-9);
	assert.equal(s.series[5]!.stat.requests, 3);
	assert.equal(s.series[5]!.other, true);
	assert.equal(s.otherCount, 2);
	assert.ok(Math.abs(s.totalSpend - 5.8) < 1e-9);
	assert.equal(s.totalRequests, 53);
	// Daily series filled with zeros for days without activity.
	const claude = s.series[0]!.daily;
	assert.equal(claude.length, 30);
	assert.equal(claude[29], 2);
	assert.equal(claude[14], 1, "Oct 20");
	assert.equal(claude.filter((v) => v === 0).length, 28);
	assert.equal(s.series[5]!.daily[0], 0.1, "qwen on Oct 6 goes to other");
});

test("summarizeActivity drops rows outside the window and handles no rows", () => {
	const rows = parseActivity({ data: [{ date: "2025-09-01", model: "old", usage: 9, requests: 1, prompt_tokens: 0, completion_tokens: 0 }] })!;
	const s = summarizeActivity(rows, NOW);
	assert.deepEqual(s.series, []);
	assert.equal(s.totalSpend, 0);
	assert.equal(s.days.length, 30);
});

test("renderChart fits the width and stacks columns proportional to the busiest day", () => {
	const s = summary();
	const lines = renderChart(s, 100, theme);
	assert.equal(lines.length, 10, "8 rows, an axis and date labels");
	for (const line of lines) assert.ok(line.length <= 100, line);
	assert.equal(lines[0]!.slice(0, 7), "$3.00 ┤");
	assert.equal(lines[8]!.slice(0, 7), "   $0 └");
	// Gutter of 7, then 3 columns per day (2 wide + 1 gap): Nov 4 at 94, Nov 3 at 91, Oct 20 at 49.
	const column = (x: number) => lines.slice(0, 8).map((line) => line[x] ?? " ").join("");
	assert.equal(column(94), "████████", "the busiest day fills the chart");
	assert.equal(column(95), "████████");
	assert.equal(column(91), "     ▁██", "0.8 of 3.0 is 17/64");
	assert.equal(column(49), "     ▅██", "1.0 of 3.0 is 21/64");
	assert.equal(column(52), "        ", "an empty day");
	assert.match(lines[9]!, /^ {7}Oct 6 {16}Oct 13 {15}Oct 20 {15}Oct 27 {15}Nov 3/);
	for (const width of [60, 40, 20, 8]) {
		for (const line of renderChart(s, width, theme)) assert.ok(line.length <= width, `${width}: ${line}`);
	}
	assert.match(renderChart(s, 40, theme)[0]!, /█/, "narrow panels still draw the latest days");
});

test("renderModels shows the 30-day total, ranking and tokens", () => {
	const lines = renderModels(summary(), 100, theme);
	for (const line of lines) assert.ok(line.length <= 100, line);
	assert.equal(lines[0], "Spend in last 30 days  $5.80 · 53 requests");
	assert.equal(lines[1], "Completed UTC days only · today is on the Quota tab");
	assert.ok(lines.includes("Daily spend by model"));
	assert.ok(lines.includes("Ranking by model"));
	assert.ok(lines.includes("Tokens by model"));
	const name = (text: string) => text.padEnd(25);
	assert.ok(lines.includes(`■ ${name("anthropic/claude-sonnet-4")}  $3.00   52%  ▰▰▰▰▰▱▱▱▱▱  15 req`));
	assert.ok(lines.includes(`■ ${name("openai/gpt-4o (BYOK)")}  $1.00   17%  ▰▰▱▱▱▱▱▱▱▱   4 req`));
	assert.ok(lines.includes(`■ ${name("deepseek/deepseek-chat")}  $0.40    7%  ▰▱▱▱▱▱▱▱▱▱  20 req`));
	assert.ok(lines.includes(`■ ${name("other (2 models)")}  $0.30    5%  ▰▱▱▱▱▱▱▱▱▱   3 req`));
	const ranking = lines.indexOf("Ranking by model");
	assert.match(lines[ranking + 1]!, /claude/);
	assert.match(lines[ranking + 6]!, /other/, "other is always last");
	assert.ok(lines.includes(`  ${name("")}   prompt  completion  reasoning   cached`));
	assert.ok(lines.includes(`■ ${name("anthropic/claude-sonnet-4")}     1.2M        340k        40k    12.5k`));
	assert.ok(lines.includes(`■ ${name("other (2 models)")}       2k         200          0        0`));
	for (const line of renderModels(summary(), 60, theme)) assert.ok(line.length <= 60, line);
});

test("renderModels says so when there is no activity, and the missing-key view explains setup", () => {
	const empty = renderModels(summarizeActivity([], NOW), 100, theme);
	assert.ok(empty.includes("No activity in the last 30 days."));
	assert.ok(!empty.some((line) => line.includes("Ranking")));
	const text = renderMissingKey(theme).join("\n");
	assert.match(text, /management key/);
	assert.match(text, /https:\/\/openrouter\.ai\/settings\/management-keys/);
	assert.match(text, /export OPENROUTER_MANAGEMENT_KEY=\.\.\./);
	assert.match(text, /restart Pi/);
	assert.match(text, /read-only GET \/api\/v1\/activity/);
});

test("formatCount compacts token counts", () => {
	assert.deepEqual([0, 999, 1000, 12_500, 340_000, 999_999, 1_200_000, 2_500_000_000].map(formatCount), ["0", "999", "1k", "12.5k", "340k", "1M", "1.2M", "2.5B"]);
});
