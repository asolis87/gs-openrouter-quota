import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchKeyInfo, OPENROUTER_KEY_URL, parseKeyInfo, resolveApiKey } from "../lib/openrouter.ts";

export const SAMPLE = {
	data: {
		label: "sk-or-v1-abc...xyz",
		limit: 20,
		limit_reset: "monthly",
		limit_remaining: 5,
		include_byok_in_limit: false,
		budgets: [
			{ scope: "workspace", guardrail_id: null, budget_id: "b1", limit_usd: 100, spend_usd: 90, remaining_usd: 10, reset_interval: "weekly", resets_at: "2025-11-10T00:00:00Z", include_byok: false },
			{ scope: "key_limit", guardrail_id: null, budget_id: null, limit_usd: 20, spend_usd: 15, remaining_usd: 5, reset_interval: null, resets_at: null, include_byok: false },
		],
		effective_budget: { scope: "workspace", guardrail_id: null, budget_id: "b1", limit_usd: 100, spend_usd: 90, remaining_usd: 10, reset_interval: "weekly", resets_at: "2025-11-10T00:00:00Z", include_byok: false },
		usage: 42.5,
		usage_daily: 1.25,
		usage_weekly: 7.5,
		usage_monthly: 15,
		byok_usage: 3,
		byok_usage_daily: 0,
		byok_usage_weekly: 1,
		byok_usage_monthly: 2,
		is_free_tier: false,
		free_model_daily_requests: { used: 40, limit: 1000, remaining: 960 },
		rate_limit: { requests: 10, interval: "10s" },
	},
};

test("parseKeyInfo maps every documented field", () => {
	const info = parseKeyInfo(SAMPLE);
	assert.ok(info);
	assert.equal(info.label, "sk-or-v1-abc...xyz");
	assert.equal(info.isFreeTier, false);
	assert.deepEqual(info.keyLimit, { limit: 20, remaining: 5, reset: "monthly", includeByok: false });
	assert.deepEqual(info.usage, { total: 42.5, daily: 1.25, weekly: 7.5, monthly: 15 });
	assert.deepEqual(info.byokUsage, { total: 3, daily: 0, weekly: 1, monthly: 2 });
	assert.deepEqual(info.freeRequests, { used: 40, limit: 1000, remaining: 960 });
	assert.equal(info.budgets.length, 2);
	assert.deepEqual(info.budgets[0], { scope: "workspace", limitUsd: 100, spendUsd: 90, remainingUsd: 10, resetInterval: "weekly", resetsAt: Date.parse("2025-11-10T00:00:00Z"), includeByok: false });
	assert.equal(info.budgets[1]!.resetsAt, null);
	assert.equal(info.effectiveBudget?.scope, "workspace");
});

test("parseKeyInfo treats a null limit as unlimited and tolerates missing optional sections", () => {
	const info = parseKeyInfo({ data: { label: "k", limit: null, limit_reset: null, limit_remaining: null, usage: 0, is_free_tier: true } });
	assert.ok(info);
	assert.equal(info.keyLimit, null);
	assert.deepEqual(info.budgets, []);
	assert.equal(info.effectiveBudget, null);
	assert.equal(info.freeRequests, null);
	assert.deepEqual(info.usage, { total: 0, daily: null, weekly: null, monthly: null });
	assert.equal(info.byokUsage, null);
	assert.equal(info.isFreeTier, true);
});

test("parseKeyInfo rejects malformed payloads", () => {
	for (const bad of [null, 1, "x", {}, { data: null }, { data: { usage: "1" } }, { data: { usage: 1, budgets: [{ scope: "x" }] } }]) {
		assert.equal(parseKeyInfo(bad), undefined, JSON.stringify(bad));
	}
});

test("fetchKeyInfo calls the key endpoint with a bearer token and no redirects", async () => {
	let seen: { url: string; init: RequestInit } | undefined;
	const fetchFn = (async (url: string, init: RequestInit) => {
		seen = { url, init };
		return new Response(JSON.stringify(SAMPLE), { status: 200 });
	}) as unknown as typeof fetch;
	const result = await fetchKeyInfo("sk-test", fetchFn);
	assert.equal(result.ok, true);
	assert.equal(seen?.url, OPENROUTER_KEY_URL);
	assert.equal((seen?.init.headers as Record<string, string>).Authorization, "Bearer sk-test");
	assert.equal(seen?.init.redirect, "error");
	assert.equal(seen?.init.cache, "no-store");
});

test("fetchKeyInfo reports missing key, HTTP errors, bad payloads and network failures", async () => {
	const never = (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
	assert.deepEqual(await fetchKeyInfo(undefined, never), { ok: false, error: "No OpenRouter API key. Run /login openrouter or set OPENROUTER_API_KEY." });
	const status = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
	assert.deepEqual(await fetchKeyInfo("k", status), { ok: false, error: "OpenRouter answered HTTP 401." });
	const garbage = (async () => new Response(JSON.stringify({ nope: true }), { status: 200 })) as unknown as typeof fetch;
	assert.deepEqual(await fetchKeyInfo("k", garbage), { ok: false, error: "OpenRouter returned an unexpected payload." });
	const offline = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
	assert.deepEqual(await fetchKeyInfo("k", offline), { ok: false, error: "Could not reach OpenRouter: ECONNRESET" });
});

test("resolveApiKey prefers the Pi provider key and falls back to OPENROUTER_API_KEY", async () => {
	const registry = (key: string | undefined) => ({ getApiKeyForProvider: async (p: string) => (p === "openrouter" ? key : undefined) });
	assert.equal(await resolveApiKey(registry("pi-key"), { OPENROUTER_API_KEY: "env-key" }), "pi-key");
	assert.equal(await resolveApiKey(registry(undefined), { OPENROUTER_API_KEY: "env-key" }), "env-key");
	assert.equal(await resolveApiKey({ getApiKeyForProvider: async () => { throw new Error("x"); } }, { OPENROUTER_API_KEY: "env-key" }), "env-key");
	assert.equal(await resolveApiKey(undefined, {}), undefined);
	assert.equal(await resolveApiKey(registry(""), { OPENROUTER_API_KEY: "  " }), undefined);
});
