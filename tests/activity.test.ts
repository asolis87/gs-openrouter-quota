import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY } from "./fixtures.ts";
import { fetchActivity, MANAGEMENT_ENV_KEY, OPENROUTER_ACTIVITY_URL, parseActivity } from "../lib/activity.ts";

test("parseActivity maps every documented row field", () => {
	const rows = parseActivity(ACTIVITY);
	assert.ok(rows);
	assert.equal(rows.length, 8);
	assert.deepEqual(rows[0], {
		date: "2025-11-04", model: "anthropic/claude-sonnet-4", permaslug: "anthropic/claude-sonnet-4-2025", provider: "Provider",
		usage: 2, byokUsage: 0, requests: 10, promptTokens: 1_000_000, completionTokens: 300_000, reasoningTokens: 40_000, cachedTokens: 12_500,
	});
	assert.equal(rows[2]!.byokUsage, 0.5);
});

test("parseActivity tolerates missing optional fields and an empty window", () => {
	assert.deepEqual(parseActivity({ data: [] }), []);
	const rows = parseActivity({ data: [{ date: "2025-11-04 00:00:00", model: "m", usage: 1, requests: 2, prompt_tokens: 3, completion_tokens: 4 }] });
	assert.deepEqual(rows, [{ date: "2025-11-04", model: "m", permaslug: null, provider: null, usage: 1, byokUsage: 0, requests: 2, promptTokens: 3, completionTokens: 4, reasoningTokens: 0, cachedTokens: 0 }]);
});

test("parseActivity rejects malformed payloads", () => {
	const good = { date: "2025-11-04", model: "m", usage: 1, requests: 2, prompt_tokens: 3, completion_tokens: 4 };
	for (const bad of [
		null, 1, "x", {}, { data: null }, { data: {} }, { data: [null] },
		{ data: [{ ...good, date: "Nov 4" }] },
		{ data: [{ ...good, model: 3 }] },
		{ data: [{ ...good, usage: "1" }] },
		{ data: [{ ...good, requests: undefined }] },
		{ data: [{ ...good, reasoning_tokens: "many" }] },
		{ data: [{ ...good, byok_usage_inference: Number.NaN }] },
	]) {
		assert.equal(parseActivity(bad), undefined, JSON.stringify(bad));
	}
});

test("fetchActivity calls only the activity endpoint with a bearer token and no redirects", async () => {
	let seen: { url: string; init: RequestInit } | undefined;
	const fetchFn = (async (url: string, init: RequestInit) => {
		seen = { url, init };
		return new Response(JSON.stringify(ACTIVITY), { status: 200 });
	}) as unknown as typeof fetch;
	const result = await fetchActivity("mgmt-key", fetchFn);
	assert.equal(result.ok, true);
	assert.equal(result.ok && result.rows.length, 8);
	assert.equal(seen?.url, OPENROUTER_ACTIVITY_URL);
	assert.equal(OPENROUTER_ACTIVITY_URL, "https://openrouter.ai/api/v1/activity");
	assert.equal(seen?.init.method, "GET");
	assert.equal((seen?.init.headers as Record<string, string>).Authorization, "Bearer mgmt-key");
	assert.equal(seen?.init.redirect, "error");
	assert.equal(seen?.init.cache, "no-store");
});

test("fetchActivity reports a missing key without fetching, and hints at management keys on 401/403", async () => {
	assert.equal(MANAGEMENT_ENV_KEY, "OPENROUTER_MANAGEMENT_KEY");
	const never = (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
	for (const key of [undefined, "", "   "]) {
		assert.deepEqual(await fetchActivity(key, never), { ok: false, missingKey: true, error: "No OpenRouter management key. Set OPENROUTER_MANAGEMENT_KEY." });
	}
	for (const status of [401, 403]) {
		const denied = (async () => new Response("no", { status })) as unknown as typeof fetch;
		assert.deepEqual(await fetchActivity("k", denied), {
			ok: false,
			error: `OpenRouter answered HTTP ${status}. /api/v1/activity needs a management key, not an inference API key.`,
		});
	}
	const status = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
	assert.deepEqual(await fetchActivity("k", status), { ok: false, error: "OpenRouter answered HTTP 500." });
	const garbage = (async () => new Response(JSON.stringify({ nope: true }), { status: 200 })) as unknown as typeof fetch;
	assert.deepEqual(await fetchActivity("k", garbage), { ok: false, error: "OpenRouter returned an unexpected payload." });
	const offline = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
	assert.deepEqual(await fetchActivity("k", offline), { ok: false, error: "Could not reach OpenRouter: ECONNRESET" });
});
