# Changelog

## 0.1.0

- OpenRouter usage source for Gentle Shell's `alt+u` view: budgets, key limit and free-model requests as percent meters.
- `/openrouter` command with dollar detail (key limit, budgets, daily/weekly/monthly/all-time usage, BYOK, free-model requests).
- Threshold alerts configurable with `OPENROUTER_QUOTA_ALERT_PERCENT` (default 80, `0` disables).
- API key from Pi's `openrouter` credential, falling back to `OPENROUTER_API_KEY`.
