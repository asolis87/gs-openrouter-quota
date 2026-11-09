import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { QuotaView } from "../lib/quota-view.ts";
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

// Fixed-origin and time-bounded: the only URL this command ever requests.
const boundedFetch = ((input: unknown, init?: RequestInit) => {
	if (String(input) !== OPENROUTER_KEY_URL) return Promise.reject(new Error("unexpected URL"));
	return fetch(OPENROUTER_KEY_URL, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}) as typeof fetch;

export default function openrouterQuota(pi: ExtensionAPI): void {
	// Re-emitting on every session_start is safe: gentle-shell keeps the newest
	// source per provider. Without gentle-shell installed nobody listens.
	pi.on("session_start", () => {
		pi.events.emit(USAGE_SOURCE_EVENT, createUsageSource(process.env));
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

			// Without a TUI (print/JSON modes) there is no overlay: append the card.
			if (!ctx.hasUI) {
				const result = await load();
				if (result.ok) pi.appendEntry<ReportEntry>(ENTRY_TYPE, { info: result.info, fetchedAt: Date.now(), threshold });
				return;
			}

			// A centered overlay like Gentle Shell's alt+u panel: r refresh, esc close.
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
						onAlerts: (alerts) => {
							for (const alert of alerts) ctx.ui.notify(alert.message, alert.level);
						},
						onClose: () => done(null),
						requestRender: () => tui.requestRender(),
					});
					view.refresh();
					return view;
				},
				{ overlay: true, overlayOptions: { width: "80%", minWidth: 60, anchor: "center" } },
			);
		},
	});
}
