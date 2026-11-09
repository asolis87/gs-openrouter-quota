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
