# Changelog

## 0.3.0

- `/openrouter` overlay gets tabs: **Quota** (the existing report) and **Models**, switched with `tab`. `r` refreshes the active tab.
- Models tab: spend per model over the last 30 completed UTC days from `GET /api/v1/activity` — a stacked daily chart (top 5 models plus `other`), a ranking in $ and % (BYOK marked) with requests, and prompt/completion/reasoning/cached tokens per model.
- The Models tab uses a management key read only from `OPENROUTER_MANAGEMENT_KEY`; it is only sent to that read-only endpoint. Without it, the tab explains how to create one.

## 0.2.1

- `esc` now closes the `/openrouter` overlay in terminals with extended keyboard protocols (e.g. kitty), using the TUI's own key matcher.

## 0.2.0

- `/openrouter` opens a centered overlay framed like Gentle Shell's `alt+u` panel, with `r` to refresh and `esc`/`q` to close. Print/JSON modes still get the card.
- The `key_limit` budget is no longer listed twice; its `blocks first` marker moves to the Key limit line.
- Local devDependencies and an `npm run typecheck` script.

## 0.1.0

- OpenRouter usage source for Gentle Shell's `alt+u` view: budgets, key limit and free-model requests as percent meters.
- `/openrouter` command with dollar detail (key limit, budgets, daily/weekly/monthly/all-time usage, BYOK, free-model requests).
- Threshold alerts configurable with `OPENROUTER_QUOTA_ALERT_PERCENT` (default 80, `0` disables).
- API key from Pi's `openrouter` credential, falling back to `OPENROUTER_API_KEY`.
