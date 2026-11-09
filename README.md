# gs-openrouter-quota

See your OpenRouter quota inside [Pi](https://pi.dev) and [Gentle Shell](https://github.com/Gentleman-Programming/gentle-shell): plan, per-key credit limit, budgets, spend, BYOK usage and free-model requests.

- **`alt+u` integration** — OpenRouter shows up in Gentle Shell's usage view next to Codex, Anthropic and NaN, with percent meters and reset times.
- **`/openrouter` command** — the full dollar detail the usage view cannot show, plus alerts when a limit crosses your threshold.

## Install

```bash
pi install git:github.com/asolis87/gs-openrouter-quota
```

Requires Node.js 22.19+ and Pi. Gentle Shell is optional: without it, `/openrouter` still works.

## API key

The key is resolved in this order:

1. Pi's own OpenRouter credential (`/login openrouter`, or however Pi is configured for the `openrouter` provider).
2. The `OPENROUTER_API_KEY` environment variable.

The key is only sent to `https://openrouter.ai/api/v1/key`. It is never stored or logged.

## `alt+u` usage view

Gentle Shell lists usage for the providers your session uses, so OpenRouter appears when the active model (or a subagent route in your profile) is an `openrouter/...` model.

```
✿ openrouter · paid · updated just now
  workspace budget week ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱  90% · resets in 4d 8h
  key month             ▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱  75% · resets in 25d 8h
  free models day       ▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱   4% · resets in 8h 30m
```

| Row | Source field | Window |
|---|---|---|
| `<scope> budget` | each entry of `budgets` (guardrail, workspace) | `reset_interval` / `resets_at` |
| `key` | `limit`, `limit_remaining` | `limit_reset`, or none |
| `free models` | `free_model_daily_requests` | UTC day |

The most used limit comes first, so it is the one the status bar shows. Gentle Shell refreshes the view itself: at session start, after responses (at most every 5 minutes), and with `r` in the view.

## `/openrouter`

Fetches once, on demand, and prints a card that stays out of the model's context:

```
OpenRouter · sk-or-v1-abc...xyz · paid
Key limit    $15.00 of $20.00 used (75%) · $5.00 left · monthly, resets in 25d 8h
Budgets
  workspace  $90.00 of $100.00 used (90%) · $10.00 left · weekly, resets in 4d 8h · blocks first
  key limit  $15.00 of $20.00 used (75%) · $5.00 left · never resets
Usage        today $1.25 · week $7.50 · month $15.00 · all time $42.50
BYOK         today $0.00 · week $1.00 · month $2.00 · all time $3.00
Free models  40 of 1000 requests today (4%) · 960 left · resets in 8h 30m
Alerts at 80% · refresh with /openrouter
```

`blocks first` marks the budget OpenRouter reports as `effective_budget`.

### Alerts

After each `/openrouter`, every limit at or above the threshold raises a warning; an exhausted one (nothing left) raises an error.

| `OPENROUTER_QUOTA_ALERT_PERCENT` | Effect |
|---|---|
| unset | alerts at 80% |
| `1`–`100` | alerts at that percent |
| `0` | alerts off |
| anything else | falls back to 80% |

## Limits of what OpenRouter reports

- Request rate limits are not exposed ahead of time: OpenRouter only sends `X-RateLimit-*` headers on rate-limit errors.
- The account balance itself is not part of `/api/v1/key`; the key limit and budgets are what block requests.

## Development

```bash
npm test
```

Tests use `node:test` with type stripping; no build step.

## Gentle Hub

This repository is listed on [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/) through its GitHub topics `gentle-shell-package` and `gentle-shell-extension`.

## License

MIT
