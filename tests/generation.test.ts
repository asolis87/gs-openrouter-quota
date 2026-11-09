import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedGenerationUrl, correctedEntry, fetchGeneration, GENERATION_URL, isGenerationId, parseGeneration } from "../lib/generation.ts";
import type { LedgerEntry } from "../lib/ledger.ts";

const GEN = { data: { id: "gen-123-abc", total_cost: 0.0042, is_byok: false, model: "anthropic/claude-sonnet-4", native_tokens_prompt: 10, native_tokens_completion: 2 } };

test("parseGeneration reads cost and BYOK defensively", () => {
	assert.equal(GENERATION_URL, "https://openrouter.ai/api/v1/generation");
	assert.deepEqual(parseGeneration(GEN), { id: "gen-123-abc", totalCost: 0.0042, isByok: false, upstreamCost: 0, model: "anthropic/claude-sonnet-4" });
	assert.deepEqual(parseGeneration({ data: { id: "g", total_cost: 0.001, is_byok: true, upstream_inference_cost: 0.02 } }), { id: "g", totalCost: 0.001, isByok: true, upstreamCost: 0.02, model: undefined });
	for (const bad of [null, {}, { data: null }, { data: { id: "g" } }, { data: { id: 1, total_cost: 1 } }, { data: { id: "g", total_cost: "1" } }, { data: { id: "g", total_cost: 1, upstream_inference_cost: "x" } }]) {
		assert.equal(parseGeneration(bad), undefined, JSON.stringify(bad));
	}
});

test("isGenerationId accepts only short url-safe ids", () => {
	for (const id of ["gen-1730800000-abcDEF123", "a", "A_b-9", "x".repeat(128)]) assert.equal(isGenerationId(id), true, id);
	for (const id of ["", "x".repeat(129), "../etc", "a b", "a?b", "a&id=b", "gen%2F", undefined, 3]) assert.equal(isGenerationId(id), false, String(id));
});

test("fetchGeneration GETs the encoded id with a bearer token and no redirects", async () => {
	let seen: { url: string; init: RequestInit } | undefined;
	const fetchFn = (async (url: string, init: RequestInit) => {
		seen = { url, init };
		return new Response(JSON.stringify(GEN), { status: 200 });
	}) as unknown as typeof fetch;
	const result = await fetchGeneration("gen-123-abc", "sk-or-key", fetchFn);
	assert.deepEqual(result, { ok: true, generation: parseGeneration(GEN) });
	assert.equal(seen?.url, "https://openrouter.ai/api/v1/generation?id=gen-123-abc");
	assert.equal(seen?.init.method, "GET");
	assert.equal((seen?.init.headers as Record<string, string>).Authorization, "Bearer sk-or-key");
	assert.equal(seen?.init.redirect, "error");
	assert.equal(seen?.init.cache, "no-store");
});

test("fetchGeneration rejects invalid ids and missing keys without fetching, and reports failures", async () => {
	const never = (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
	assert.equal((await fetchGeneration("../x", "k", never)).ok, false);
	assert.equal((await fetchGeneration("gen-1", undefined, never)).ok, false);
	assert.equal((await fetchGeneration("gen-1", "  ", never)).ok, false);
	const status = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
	assert.deepEqual(await fetchGeneration("gen-1", "k", status), { ok: false, error: "OpenRouter answered HTTP 404." });
	const garbage = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
	assert.deepEqual(await fetchGeneration("gen-1", "k", garbage), { ok: false, error: "OpenRouter returned an unexpected payload." });
	const offline = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
	assert.deepEqual(await fetchGeneration("gen-1", "k", offline), { ok: false, error: "Could not reach OpenRouter: ECONNRESET" });
});

test("allowedGenerationUrl admits exactly the generation endpoint with one valid id", () => {
	assert.equal(allowedGenerationUrl("https://openrouter.ai/api/v1/generation?id=gen-123-abc"), "https://openrouter.ai/api/v1/generation?id=gen-123-abc");
	for (const url of [
		"https://openrouter.ai/api/v1/generation",
		"https://openrouter.ai/api/v1/generation?id=",
		"https://openrouter.ai/api/v1/generation?id=..%2Fkey",
		"https://openrouter.ai/api/v1/generation?id=a&id=b",
		"https://openrouter.ai/api/v1/generation?id=a&x=1",
		"https://openrouter.ai/api/v1/generation/x?id=a",
		"https://evil.example/api/v1/generation?id=a",
		"http://openrouter.ai/api/v1/generation?id=a",
		"https://user@openrouter.ai/api/v1/generation?id=a",
		"https://openrouter.ai:8443/api/v1/generation?id=a",
		"https://openrouter.ai/api/v1/generation?id=a#frag",
		"https://openrouter.ai/api/v1/key",
		"not a url",
	]) {
		assert.equal(allowedGenerationUrl(url), undefined, url);
	}
});

test("correctedEntry keeps the id and tokens, replacing cost with the billed one", () => {
	const estimate: LedgerEntry = { v: 1, id: "gen-1", ts: 1, model: "m", cost: 0.01, estimated: true, requests: 1, prompt: 10, completion: 2, reasoning: 0, cached: 0 };
	assert.deepEqual(correctedEntry(estimate, { id: "gen-1", totalCost: 0.002, isByok: false, upstreamCost: 0 }), { ...estimate, cost: 0.002, estimated: false, byok: false });
	const byok = correctedEntry(estimate, { id: "gen-1", totalCost: 0.001, isByok: true, upstreamCost: 0.03 });
	assert.ok(Math.abs(byok.cost - 0.031) < 1e-12);
	assert.equal(byok.byok, true);
});
