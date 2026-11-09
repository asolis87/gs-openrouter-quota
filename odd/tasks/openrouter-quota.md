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

## Tasks
- T1 [S2] OpenRouter key-info client + parser (pure, tested). route: inline. commit: —
- T2 [S3,S4] gentle-shell usage source mapping + registration. route: inline. commit: —
- T3 [S5,S6,S7] `/openrouter` command: detail rendering + threshold alerts. route: inline. commit: —
- T4 [S1] Package metadata, README, Gentle Hub topics instructions. route: inline. commit: —

## Log
- L1: "Hola, quiero agregar un paquete/extension a gentle-shell que pueda verse en https://gentlemanprogramming.com/gentle-hub/ , mi idea es tener una forma de visualizar la quota de openrouter, ya sea por plan o por api , los limites y toda la info que pueda resultarle util al usuario, se entiende?"
- L1b: Answers — UI: "en gentle-shell existe un comando alt+u donde te muestra ciertas quotas, me gustaria ver de que forma podemos integrar openrouter ahi si es posible. podemos analizar esa opcion?"; key: "Ambas, con fallback"; refresh: "Solo a demanda"; alerts: "Sí, con umbral configurable".
- L2: Proposal accepted (alt+u hook integration + `/openrouter` command; alt+u uses the shell's automatic refresh): "vamos con ambas, me cierra perfecto"
