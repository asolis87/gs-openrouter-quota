# gs-openrouter-quota

See your OpenRouter quota inside [Pi](https://pi.dev) and [Gentle Shell](https://github.com/Gentleman-Programming/gentle-shell): plan, per-key credit limit, budgets, spend, BYOK usage and free-model requests.

- **`alt+u` integration** — OpenRouter shows up in Gentle Shell's usage view next to Codex, Anthropic and NaN, with percent meters and reset times.
- **`/openrouter` command** — the full dollar detail the usage view cannot show, plus alerts when a limit crosses your threshold.
- **Models tab** — spend per model over the last 30 days, like OpenRouter's activity page: a stacked daily chart, a ranking in $ and %, and tokens per model.

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

The Models tab needs a separate **management key**, read only from `OPENROUTER_MANAGEMENT_KEY` (never from Pi's provider auth). See [Models tab](#models-tab).

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

Opens a centered overlay framed like Gentle Shell's `alt+u` panel, with two tabs: **Quota** (below) and **Models**. It fetches the quota once when it opens; press `tab` to switch tabs, `r` to refresh the active tab and `esc` (or `q`) to close. Nothing it shows enters the model's context.

```
╭─ ✿ OpenRouter ─ Quota · Models ──────────────────────────────────────────────────────────────────────╮
│ sk-or-v1-abc...xyz · paid                                                                            │
│ Key limit    $15.00 of $20.00 used (75%) · $5.00 left · monthly, resets in 25d 8h                    │
│ Budgets                                                                                              │
│   workspace  $90.00 of $100.00 used (90%) · $10.00 left · weekly, resets in 4d 8h · blocks first     │
│ Usage        today $1.25 · week $7.50 · month $15.00 · all time $42.50                               │
│ BYOK         today $0.00 · week $1.00 · month $2.00 · all time $3.00                                 │
│ Free models  40 of 1000 requests today (4%) · 960 left · resets in 8h 30m                            │
│ Alerts at 80%                                                                                        │
│ tab switch   r refresh   esc close                                                                   │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

Without a TUI (print or JSON mode) the same report is appended as a card instead.

`blocks first` marks the limit OpenRouter reports as `effective_budget`. OpenRouter also lists the key's own limit as a `key_limit` budget; it is shown once, on the Key limit line.

### Models tab

Spend per model over the last 30 **completed UTC days**, from `GET https://openrouter.ai/api/v1/activity`. Today is not part of that window; today's spend is on the Quota tab. The data is fetched the first time you open the tab and again on `r` while it is active.

```
╭─ ✿ OpenRouter ─ Quota · Models ──────────────────────────────────────────────────────────────────╮
│ Spend in last 30 days  $5.80 · 53 requests                                                       │
│ Completed UTC days only · today is on the Quota tab                                              │
│                                                                                                  │
│ Daily spend by model                                                                             │
│ $3.00 ┤                                                                                       ██ │
│       │                                                                                       ██ │
│       │                                                                                       ██ │
│       │                                                                                       ██ │
│       │                                                                                       ██ │
│       │                                          ▅▅                                        ▁▁ ██ │
│       │▃▃                         ▃▃             ██                                        ██ ██ │
│       │██                         ██             ██                                        ██ ██ │
│    $0 └───────────────────────────────────────────────────────────────────────────────────────── │
│        Oct 6                Oct 13               Oct 20               Oct 27               Nov 3 │
│                                                                                                  │
│ Ranking by model                                                                                 │
│ ■ anthropic/claude-sonnet-4  $3.00   52%  ▰▰▰▰▰▱▱▱▱▱  15 req                                     │
│ ■ openai/gpt-4o (BYOK)       $1.00   17%  ▰▰▱▱▱▱▱▱▱▱   4 req                                     │
│ ■ google/gemini-2.5-pro      $0.80   14%  ▰▱▱▱▱▱▱▱▱▱   8 req                                     │
│ ■ deepseek/deepseek-chat     $0.40    7%  ▰▱▱▱▱▱▱▱▱▱  20 req                                     │
│ ■ meta-llama/llama-3.3-70b   $0.30    5%  ▰▱▱▱▱▱▱▱▱▱   3 req                                     │
│ ■ other (2 models)           $0.30    5%  ▰▱▱▱▱▱▱▱▱▱   3 req                                     │
│                                                                                                  │
│ Tokens by model                                                                                  │
│                               prompt  completion  reasoning   cached                             │
│ ■ anthropic/claude-sonnet-4     1.2M        340k        40k    12.5k                             │
│ ■ openai/gpt-4o (BYOK)            1k         100          0        0                             │
│ ...                                                                                              │
│ tab switch   r refresh   esc close                                                               │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
```

- **Daily chart** — one column per day, stacked by model; the top 5 models get their own color, the rest are grouped as `other`. Narrow panels show the most recent days.
- **Ranking** — spend (including BYOK inference, marked `(BYOK)`), share of the 30-day total, and requests.
- **Tokens** — prompt, completion, reasoning and cached tokens per model.

#### Management key

`/api/v1/activity` only accepts a [management key](https://openrouter.ai/settings/management-keys), not a regular inference key:

1. Create one in OpenRouter → Settings → Management Keys.
2. `export OPENROUTER_MANAGEMENT_KEY=...` and restart Pi.

Without it, the Models tab shows these instructions instead.

> **Security:** a management key can create, change and delete your API keys. This package reads it only from `OPENROUTER_MANAGEMENT_KEY`, sends it only with the read-only `GET https://openrouter.ai/api/v1/activity`, and never stores, logs or renders it. Its requests are limited to a fixed URL allowlist (`/api/v1/key` and `/api/v1/activity`).

### Alerts

Each time `/openrouter` fetches the quota (on open and on `r` in the Quota tab), every limit at or above the threshold raises a warning; an exhausted one (nothing left) raises an error.

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
npm install
npm test
npm run typecheck
```

Tests use `node:test` with type stripping; no build step.

## Gentle Hub

This repository is listed on [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/) through its GitHub topics `gentle-shell-package` and `gentle-shell-extension`.

## License

MIT
