import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeyInfo } from "../lib/openrouter.ts";
import { DEFAULT_THRESHOLD, findAlerts, formatUsd, parseThreshold, renderReport } from "../lib/report.ts";
import { SAMPLE } from "./fixtures.ts";

const NOW = Date.UTC(2025, 10, 5, 15, 30);
const plain = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

test("formatUsd keeps cents and shows sub-cent spend", () => {
	assert.equal(formatUsd(0), "$0.00");
	assert.equal(formatUsd(12.5), "$12.50");
	assert.equal(formatUsd(0.0042), "$0.0042");
	assert.equal(formatUsd(-1.5), "-$1.50");
});

test("renderReport shows every dollar detail alt+u cannot", () => {
	const lines = renderReport(parseKeyInfo(SAMPLE)!, NOW, 80, plain);
	assert.deepEqual(lines, [
		"OpenRouter · sk-or-v1-abc...xyz · paid",
		"Key limit    $15.00 of $20.00 used (75%) · $5.00 left · monthly, resets in 25d 8h",
		"Budgets",
		"  workspace  $90.00 of $100.00 used (90%) · $10.00 left · weekly, resets in 4d 8h · blocks first",
		"Usage        today $1.25 · week $7.50 · month $15.00 · all time $42.50",
		"BYOK         today $0.00 · week $1.00 · month $2.00 · all time $3.00",
		"Free models  40 of 1000 requests today (4%) · 960 left · resets in 8h 30m",
		"Alerts at 80% · refresh with /openrouter",
	]);
});

test("renderReport folds the key_limit budget into the key line, keeping blocks first", () => {
	const info = parseKeyInfo({ data: { label: "k", limit: 1000, limit_remaining: 957.79, limit_reset: "daily", usage: 1161, is_free_tier: false,
		budgets: [{ scope: "key_limit", limit_usd: 1000, spend_usd: 42.21, remaining_usd: 957.79, reset_interval: "daily", resets_at: null }],
		effective_budget: { scope: "key_limit", limit_usd: 1000, spend_usd: 42.21, remaining_usd: 957.79, reset_interval: "daily", resets_at: null } } })!;
	const lines = renderReport(info, NOW, 80, plain);
	assert.deepEqual(lines.slice(0, 3), [
		"OpenRouter · k · paid",
		"Key limit    $42.21 of $1000.00 used (4%) · $957.79 left · daily, resets in 8h 30m · blocks first",
		"Usage        all time $1161.00",
	]);
});

test("renderReport covers an unlimited free-tier key without optional sections", () => {
	const info = parseKeyInfo({ data: { label: "k", limit: null, usage: 0, is_free_tier: true } })!;
	assert.deepEqual(renderReport(info, NOW, 0, plain), [
		"OpenRouter · k · free tier",
		"Key limit    unlimited",
		"Usage        all time $0.00",
		"Alerts off · refresh with /openrouter",
	]);
});

test("findAlerts reports every limit at or above the threshold", () => {
	const info = parseKeyInfo(SAMPLE)!;
	assert.deepEqual(findAlerts(info, 80), [{ level: "warning", message: "OpenRouter workspace budget at 90% ($10.00 left)" }]);
	assert.deepEqual(findAlerts(info, 75).map((a) => a.message), [
		"OpenRouter workspace budget at 90% ($10.00 left)",
		"OpenRouter key limit at 75% ($5.00 left)",
	]);
	assert.deepEqual(findAlerts(info, 95), []);
	assert.deepEqual(findAlerts(info, 0), [], "0 disables alerts");
});

test("findAlerts escalates exhausted limits to errors", () => {
	const info = parseKeyInfo({ data: { label: "k", limit: 10, limit_remaining: 0, usage: 10, is_free_tier: true, free_model_daily_requests: { used: 50, limit: 50, remaining: 0 } } })!;
	assert.deepEqual(findAlerts(info, 80), [
		{ level: "error", message: "OpenRouter key limit exhausted ($0.00 left)" },
		{ level: "error", message: "OpenRouter free model requests exhausted (0 left today)" },
	]);
});

test("parseThreshold reads OPENROUTER_QUOTA_ALERT_PERCENT with a safe default", () => {
	assert.equal(DEFAULT_THRESHOLD, 80);
	assert.equal(parseThreshold(undefined), 80);
	assert.equal(parseThreshold("90"), 90);
	assert.equal(parseThreshold("0"), 0);
	assert.equal(parseThreshold("abc"), 80);
	assert.equal(parseThreshold("150"), 80);
	assert.equal(parseThreshold("-5"), 80);
});
