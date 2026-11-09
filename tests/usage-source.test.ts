import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeyInfo } from "../lib/openrouter.ts";
import { createUsageSource, nextReset, toProviderUsage, USAGE_SOURCE_EVENT, USAGE_SOURCE_SCHEMA } from "../lib/usage-source.ts";
import { SAMPLE } from "./fixtures.ts";

// 2025-11-05 (Wednesday) 15:30 UTC
const NOW = Date.UTC(2025, 10, 5, 15, 30);

test("nextReset returns the next UTC day, Monday and month boundaries", () => {
	assert.equal(nextReset("daily", NOW), Date.UTC(2025, 10, 6));
	assert.equal(nextReset("weekly", NOW), Date.UTC(2025, 10, 10));
	assert.equal(nextReset("monthly", NOW), Date.UTC(2025, 11, 1));
	assert.equal(nextReset(null, NOW), null);
	assert.equal(nextReset("weekly", Date.UTC(2025, 10, 10, 0, 0)), Date.UTC(2025, 10, 17));
});

test("toProviderUsage maps key limit, budgets and free requests, most pressing first", () => {
	const usage = toProviderUsage(parseKeyInfo(SAMPLE)!, NOW);
	assert.equal(usage.provider, "openrouter");
	assert.equal(usage.plan, "paid");
	assert.equal(usage.fetchedAt, NOW);
	assert.deepEqual(usage.limits, [
		{ name: "workspace budget", limitReached: false, windows: [{ label: "week", usedPercent: 90, windowSeconds: 604_800, resetAt: Date.parse("2025-11-10T00:00:00Z") }] },
		{ name: "key", limitReached: false, windows: [{ label: "month", usedPercent: 75, windowSeconds: 2_592_000, resetAt: Date.UTC(2025, 11, 1) }] },
		{ name: "free models", limitReached: false, windows: [{ label: "day", usedPercent: 4, windowSeconds: 86_400, resetAt: Date.UTC(2025, 10, 6) }] },
	]);
});

test("toProviderUsage marks exhausted limits as reached and never uses provider scope", () => {
	const info = parseKeyInfo({ data: { label: "k", limit: 10, limit_remaining: 0, limit_reset: null, usage: 10, is_free_tier: true, free_model_daily_requests: { used: 50, limit: 50, remaining: 0 } } })!;
	const usage = toProviderUsage(info, NOW);
	assert.equal(usage.plan, "free");
	assert.deepEqual(usage.limits.map((l) => [l.name, l.limitReached, l.windows[0]!.usedPercent, l.windows[0]!.label, l.windows[0]!.resetAt]), [
		["key", true, 100, "", null],
		["free models", true, 100, "day", Date.UTC(2025, 10, 6)],
	]);
	for (const limit of usage.limits) assert.equal("scope" in limit, false);
});

test("toProviderUsage keeps an unlimited key with no budgets as an empty limit list", () => {
	const usage = toProviderUsage(parseKeyInfo({ data: { label: "k", limit: null, usage: 3, is_free_tier: false } })!, NOW);
	assert.deepEqual(usage.limits, []);
});

test("createUsageSource emits the documented schema and falls back to the env key", async () => {
	const source = createUsageSource({ OPENROUTER_API_KEY: "env-key" });
	assert.equal(USAGE_SOURCE_EVENT, "gentle-pi:usage-source/v1");
	assert.equal(source.schema, USAGE_SOURCE_SCHEMA);
	assert.equal(source.provider, "openrouter");
	assert.equal(typeof source.pendingNote, "string");
	let auth = "";
	const fetchFn = (async (_url: string, init: RequestInit) => {
		auth = (init.headers as Record<string, string>).Authorization!;
		return new Response(JSON.stringify(SAMPLE), { status: 200 });
	}) as unknown as typeof fetch;
	const fromShell = await source.fetch("shell-key", fetchFn, NOW);
	assert.equal(auth, "Bearer shell-key");
	assert.equal(fromShell?.limits.length, 3);
	await source.fetch(undefined, fetchFn, NOW);
	assert.equal(auth, "Bearer env-key");
});

test("createUsageSource resolves undefined when OpenRouter cannot answer", async () => {
	const failing = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
	assert.equal(await createUsageSource({}).fetch("k", failing, NOW), undefined);
	assert.equal(await createUsageSource({}).fetch(undefined, failing, NOW), undefined);
});
