# Feature: openrouter-quota
Standalone Pi / Gentle Shell package that shows OpenRouter quota (plan, key limits, budgets, usage, free-model requests).
Listed on Gentle Hub via GitHub topics `gentle-shell-package` + `gentle-shell-extension`.

## Specs
- S1: "quiero agregar un paquete/extension a gentle-shell que pueda verse en https://gentlemanprogramming.com/gentle-hub/" — standalone Pi package, installable, README + topics for Gentle Hub.
- S2: "visualizar la quota de openrouter, ya sea por plan o por api , los limites y toda la info que pueda resultarle util al usuario" — data from `GET https://openrouter.ai/api/v1/key`: is_free_tier (plan), limit/limit_remaining/limit_reset, budgets[]/effective_budget, usage daily/weekly/monthly/all-time, BYOK usage, free_model_daily_requests.
- S3: "en gentle-shell existe un comando alt+u donde te muestra ciertas quotas, me gustaria ver de que forma podemos integrar openrouter ahi" — register an OpenRouter usage source via `gentle-pi:usage-source/v1` so it appears in the alt+u view (percent windows: key limit, each budget, free-model daily requests).
- S4: API key source "Ambas, con fallback" — key from Pi's OpenRouter provider auth first, then env `OPENROUTER_API_KEY`.
- S5: Refresh "Solo a demanda" — the `/openrouter` command fetches only when invoked; the alt+u integration follows gentle-shell's own refresh cadence (accepted by the user in L2).
- S6: Alerts "Sí, con umbral configurable" — notify when a key limit, budget, or free-model requests reach a configurable usage threshold (default 80%).
- S7: `/openrouter` command shows the dollar detail that alt+u cannot render (remaining, spend, daily/weekly/monthly/all-time usage, BYOK, budgets with reset times).
- S8: "se podria meter un tab a la seccion /openrouter donde pueda visualizarse el uso por modelo como lo muestra openrouter?" — the /openrouter overlay gets tabs (`tab` switches) "Quota" (current report) and "Models".
- S9: Models data from `GET https://openrouter.ai/api/v1/activity` (last 30 completed UTC days; rows per date/model/provider with usage, byok_usage_inference, requests, prompt/completion/reasoning/cached tokens). Requires a management key read only from env `OPENROUTER_MANAGEMENT_KEY` ("Env OPENROUTER_MANAGEMENT_KEY"); never stored, logged or sent anywhere else; only that GET is made with it.
- S10: Models tab shows "Gráfico diario apilado" (daily spend stacked by model, one color per top model, "Spend in last 30 days" total), "Ranking por modelo ($ y %)" (spend incl. BYOK, share of total, requests, BYOK marked) and "Tokens por modelo" (prompt, completion, reasoning, cached). No per-provider breakdown (not selected).
- S11: Without the management key the Models tab shows "Instrucciones para configurarla" (create a management key in OpenRouter Settings → Management Keys, export OPENROUTER_MANAGEMENT_KEY).
- S12: Models data is fetched on demand: when the Models tab is first opened and on `r` while it is active. Today is not in /activity; the tab says the window covers completed UTC days.

## Tasks
- T1 [S2] OpenRouter key-info client + parser (pure, tested). route: inline. commit: d7a44a8
- T2 [S3,S4] gentle-shell usage source mapping + registration. route: inline. commit: a5cf98b
- T3 [S5,S6,S7] `/openrouter` command: detail rendering + threshold alerts. route: inline. commit: 8cfe45b
- T4 [S1] Package metadata, README, Gentle Hub topics instructions. route: inline. commit: b989250
- T5 [S8-S12] Tabbed overlay + Models tab (activity client, stacked chart, ranking, tokens, missing-key instructions). route: delegated worker (context backstop) + independent verify (Risk item 2: management credential). commit: —

## Log
- L1: "Hola, quiero agregar un paquete/extension a gentle-shell que pueda verse en https://gentlemanprogramming.com/gentle-hub/ , mi idea es tener una forma de visualizar la quota de openrouter, ya sea por plan o por api , los limites y toda la info que pueda resultarle util al usuario, se entiende?"
- L1b: Answers — UI: "en gentle-shell existe un comando alt+u donde te muestra ciertas quotas, me gustaria ver de que forma podemos integrar openrouter ahi si es posible. podemos analizar esa opcion?"; key: "Ambas, con fallback"; refresh: "Solo a demanda"; alerts: "Sí, con umbral configurable".
- L2: Proposal accepted (alt+u hook integration + `/openrouter` command; alt+u uses the shell's automatic refresh): "vamos con ambas, me cierra perfecto"
- L3: Incident — a temp-dir `npm i` pruned the global Pi deps through a symlink; user authorized repair: "si, reinstalalo". Reinstalled @earendil-works/pi-coding-agent@1.5.0 (7 deps restored). Typecheck re-run with copied packages: tsc strict exit 0.
- L4: Evidence — 18/18 tests; gentle-shell's real parseUsageSource/parseProviderUsage accept the source and render the alt+u panel; /openrouter smoke test with a stubbed Pi (card, alerts, error and missing-key paths). Pending: live check with a real OpenRouter key; GitHub repo + topics.
- L5: "se podria meter un tab a la seccion /openrouter donde pueda visualizarse el uso por modelo como lo muestra openrouter?" Answers: "Sí, implementala"; key "Env OPENROUTER_MANAGEMENT_KEY"; content "Gráfico diario apilado, Ranking por modelo ($ y %), Tokens por modelo"; without key "Instrucciones para configurarla".
