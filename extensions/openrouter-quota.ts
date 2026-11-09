import { randomUUID } from "node:crypto";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { QuotaView } from "../lib/quota-view.ts";
import { fetchActivity, MANAGEMENT_ENV_KEY, OPENROUTER_ACTIVITY_URL } from "../lib/activity.ts";
import { allowedGenerationUrl, fetchGeneration, GENERATION_URL } from "../lib/generation.ts";
import { createRecorder, Ledger, ledgerPath, loadModelsActivity } from "../lib/ledger.ts";
import { fetchKeyInfo, OPENROUTER_KEY_URL, OPENROUTER_PROVIDER, resolveApiKey, type KeyInfo } from "../lib/openrouter.ts";
import { parseThreshold, renderReport, THRESHOLD_ENV } from "../lib/report.ts";
import { createUsageSource, USAGE_SOURCE_EVENT } from "../lib/usage-source.ts";

const ENTRY_TYPE = "openrouter-quota";
const FETCH_TIMEOUT_MS = 10_000;

interface ReportEntry {
	info: KeyInfo;
	fetchedAt: number;
	threshold: number;
}

// Fixed-origin and time-bounded: the only URLs this package ever requests. The
// generation URL is rebuilt from a validated id (url-safe, at most 128 chars).
const boundedFetch = ((input: unknown, init?: RequestInit) => {
	const url = String(input);
	if (url === OPENROUTER_KEY_URL) return fetch(OPENROUTER_KEY_URL, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (url === OPENROUTER_ACTIVITY_URL) return fetch(OPENROUTER_ACTIVITY_URL, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	const generationUrl = allowedGenerationUrl(url);
	if (generationUrl) {
		const id = new URL(generationUrl).searchParams.get("id") ?? "";
		return fetch(`${GENERATION_URL}?id=${encodeURIComponent(id)}`, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	}
	return Promise.reject(new Error("unexpected URL"));
}) as typeof fetch;

export default function openrouterQuota(pi: ExtensionAPI): void {
	// The local ledger behind the Models tab when there is no management key.
	// Every Pi process (subagents too) appends to the same file.
	const ledger = new Ledger({ path: ledgerPath(getAgentDir()) });
	let compacted = false;
	let registry: Parameters<typeof resolveApiKey>[0];

	// Re-emitting on every session_start is safe: gentle-shell keeps the newest
	// source per provider. Without gentle-shell installed nobody listens.
	pi.on("session_start", (_event, ctx) => {
		registry = ctx.modelRegistry;
		pi.events.emit(USAGE_SOURCE_EVENT, createUsageSource(process.env));
		if (!compacted) {
			compacted = true;
			void ledger.compact();
		}
	});

	// Records OpenRouter responses only; estimated costs get one billed-cost
	// lookup with the inference key, ~3s later.
	const record = createRecorder({
		append: (entry) => ledger.append(entry),
		fetchGeneration: async (id) => fetchGeneration(id, await resolveApiKey(registry, process.env), boundedFetch),
		setTimer: (fn, ms) => {
			setTimeout(fn, ms).unref?.();
		},
		fallbackId: () => `local-${randomUUID()}`,
	});
	pi.on("message_end", (event, ctx) => {
		registry = ctx.modelRegistry;
		record(event.message);
	});

	// A TUI-only card: the report stays out of the model's context.
	pi.registerEntryRenderer<ReportEntry>(ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		if (!data) return undefined;
		return new Text(renderReport(data.info, data.fetchedAt, data.threshold, theme).join("\n"), 1, 0);
	});

	pi.registerCommand(OPENROUTER_PROVIDER, {
		description: "Show OpenRouter quota: key limit, budgets, usage in $, free-model requests",
		handler: async (_args, ctx) => {
			const threshold = parseThreshold(process.env[THRESHOLD_ENV]);
			const load = async () => fetchKeyInfo(await resolveApiKey(ctx.modelRegistry, process.env), boundedFetch);
			// The management key comes only from the environment (never Pi's provider auth)
			// and is only sent to GET /api/v1/activity. It is read per fetch, never kept.
			// Without it the Models tab shows the local ledger instead.
			const loadActivity = () =>
				loadModelsActivity({
					managementKey: process.env[MANAGEMENT_ENV_KEY],
					fetchActivity: (key) => fetchActivity(key, boundedFetch),
					readLedger: () => ledger.read(),
				});

			// Without a TUI (print/JSON modes) there is no overlay: append the card.
			if (!ctx.hasUI) {
				const result = await load();
				if (result.ok) pi.appendEntry<ReportEntry>(ENTRY_TYPE, { info: result.info, fetchedAt: Date.now(), threshold });
				return;
			}

			// A centered overlay like Gentle Shell's alt+u panel: tab switch, r refresh, esc close.
			await ctx.ui.custom<null>(
				(tui, theme, _keybindings, done) => {
					const view = new QuotaView({
						theme,
						fit: (text, width) => {
							const clipped = truncateToWidth(text, width, "…");
							return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
						},
						now: () => Date.now(),
						threshold,
						load,
						loadActivity,
						onAlerts: (alerts) => {
							for (const alert of alerts) ctx.ui.notify(alert.message, alert.level);
						},
						onClose: () => done(null),
						requestRender: () => tui.requestRender(),
						isEscape: (data) => matchesKey(data, Key.escape),
						isTab: (data) => matchesKey(data, Key.tab),
					});
					view.refresh();
					return view;
				},
				{ overlay: true, overlayOptions: { width: "80%", minWidth: 60, anchor: "center" } },
			);
		},
	});
}
