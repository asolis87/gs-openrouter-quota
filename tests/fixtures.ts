// Shared fixture: a full documented GET /api/v1/key response.
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

// GET /api/v1/activity rows for the 30 completed UTC days before 2025-11-05
// (window Oct 6 – Nov 4): seven models, so the top five plus an "other" bucket.
const row = (date: string, model: string, usage: number, requests: number, extra: Record<string, unknown> = {}) => ({
	date, model, model_permaslug: `${model}-2025`, provider_name: "Provider", endpoint_id: "e1",
	usage, byok_usage_inference: 0, requests, prompt_tokens: 1000, completion_tokens: 100, reasoning_tokens: 0, cached_tokens: 0, ...extra,
});
export const ACTIVITY = {
	data: [
		row("2025-11-04", "anthropic/claude-sonnet-4", 2, 10, { prompt_tokens: 1_000_000, completion_tokens: 300_000, reasoning_tokens: 40_000, cached_tokens: 12_500 }),
		row("2025-10-20", "anthropic/claude-sonnet-4", 1, 5, { prompt_tokens: 200_000, completion_tokens: 40_000 }),
		row("2025-11-04", "openai/gpt-4o", 0.5, 4, { byok_usage_inference: 0.5 }),
		row("2025-11-03", "google/gemini-2.5-pro", 0.8, 8),
		row("2025-10-06", "deepseek/deepseek-chat", 0.4, 20),
		row("2025-10-15", "meta-llama/llama-3.3-70b", 0.3, 3),
		row("2025-10-15", "mistral/mistral-large", 0.2, 2),
		row("2025-10-06", "qwen/qwen3", 0.1, 1),
	],
};

// A Pi AssistantMessage from the openrouter provider, as `message_end` delivers it.
export const assistantMessage = (overrides: Record<string, unknown> = {}, usage: Record<string, unknown> = {}, cost: Record<string, unknown> = {}) => ({
	role: "assistant",
	content: [{ type: "text", text: "SECRET PROMPT ANSWER" }],
	api: "openai-completions",
	provider: "openrouter",
	model: "anthropic/claude-sonnet-4",
	responseModel: "anthropic/claude-4-sonnet-20250522",
	responseId: "gen-1730800000-abcDEF123",
	usage: {
		input: 1000, output: 200, cacheRead: 300, cacheWrite: 50, reasoning: 40, totalTokens: 1550,
		cost: { input: 0.003, output: 0.003, cacheRead: 0.0001, cacheWrite: 0.0002, total: 0.0063, totalFromProvider: true, ...cost },
		...usage,
	},
	stopReason: "stop",
	timestamp: Date.UTC(2025, 10, 5, 12, 0),
	...overrides,
});
