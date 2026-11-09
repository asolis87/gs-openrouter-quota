import { MANAGEMENT_ENV_KEY, type ActivityRow } from "./activity.ts";
import { formatUsd, type ReportTheme } from "./report.ts";

// The Models tab: spend per model over the last 30 completed UTC days, like
// OpenRouter's activity page. Pure: aggregation and line rendering for a width.

export const WINDOW_DAYS = 30;
export const TOP_MODELS = 5;
const DAY_MS = 86_400_000;
const CHART_ROWS = 8;
const UNITS = CHART_ROWS * 8;
const PARTIAL = ["▁", "▂", "▃", "▄", "▅", "▆", "▇"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const METER = 10;
// Documented Pi theme foreground roles, distinct enough to tell stacked segments apart.
const PALETTE = ["accent", "success", "warning", "mdLink", "syntaxKeyword"];
const OTHER_COLOR = "muted";

export interface ModelStat {
	spend: number;
	byok: number;
	requests: number;
	promptTokens: number;
	completionTokens: number;
	reasoningTokens: number;
	cachedTokens: number;
}

export interface ModelSeries {
	name: string;
	byok: boolean;
	other: boolean;
	stat: ModelStat;
	/** Spend per day, aligned with ModelsSummary.days. */
	daily: number[];
}

export interface ModelsSummary {
	/** YYYY-MM-DD, oldest first. */
	days: string[];
	/** Top models by spend, then one "other" bucket when there are more. */
	series: ModelSeries[];
	otherCount: number;
	totalSpend: number;
	totalRequests: number;
}

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const emptyStat = (): ModelStat => ({ spend: 0, byok: 0, requests: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 });

function addStat(into: ModelStat, from: ModelStat): void {
	into.spend += from.spend;
	into.byok += from.byok;
	into.requests += from.requests;
	into.promptTokens += from.promptTokens;
	into.completionTokens += from.completionTokens;
	into.reasoningTokens += from.reasoningTokens;
	into.cachedTokens += from.cachedTokens;
}

/** The window ends at the last completed UTC day (or a later row date, should OpenRouter report one). */
export function summarizeActivity(rows: ActivityRow[], now: number, top = TOP_MODELS): ModelsSummary {
	const yesterday = isoDay(Math.floor(now / DAY_MS) * DAY_MS - DAY_MS);
	const last = rows.reduce((max, row) => (row.date > max ? row.date : max), yesterday);
	const end = Date.parse(`${last}T00:00:00Z`);
	const days = Array.from({ length: WINDOW_DAYS }, (_, i) => isoDay(end - (WINDOW_DAYS - 1 - i) * DAY_MS));
	const index = new Map(days.map((day, i) => [day, i]));

	const byModel = new Map<string, { stat: ModelStat; daily: number[] }>();
	for (const row of rows) {
		const day = index.get(row.date);
		if (day === undefined) continue;
		let entry = byModel.get(row.model);
		if (!entry) byModel.set(row.model, (entry = { stat: emptyStat(), daily: new Array<number>(WINDOW_DAYS).fill(0) }));
		const spend = row.usage + row.byokUsage;
		addStat(entry.stat, {
			spend, byok: row.byokUsage, requests: row.requests, promptTokens: row.promptTokens,
			completionTokens: row.completionTokens, reasoningTokens: row.reasoningTokens, cachedTokens: row.cachedTokens,
		});
		entry.daily[day] = (entry.daily[day] ?? 0) + spend;
	}

	const ranked = [...byModel.entries()].sort(([an, a], [bn, b]) => b.stat.spend - a.stat.spend || b.stat.requests - a.stat.requests || an.localeCompare(bn));
	const series: ModelSeries[] = ranked.slice(0, top).map(([name, { stat, daily }]) => ({ name, byok: stat.byok > 0, other: false, stat, daily }));
	const rest = ranked.slice(top);
	if (rest.length > 0) {
		const stat = emptyStat();
		const daily = new Array<number>(WINDOW_DAYS).fill(0);
		for (const [, entry] of rest) {
			addStat(stat, entry.stat);
			entry.daily.forEach((value, i) => (daily[i] = (daily[i] ?? 0) + value));
		}
		series.push({ name: `other (${rest.length} models)`, byok: false, other: true, stat, daily });
	}
	return {
		days,
		series,
		otherCount: rest.length,
		totalSpend: ranked.reduce((sum, [, e]) => sum + e.stat.spend, 0),
		totalRequests: ranked.reduce((sum, [, e]) => sum + e.stat.requests, 0),
	};
}

export function formatCount(value: number): string {
	if (value < 1000) return String(Math.round(value));
	const units = ["k", "M", "B", "T"];
	let scaled = value;
	for (let i = 0; i < units.length; i++) {
		scaled /= 1000;
		const text = scaled < 100 ? scaled.toFixed(1).replace(/\.0$/, "") : String(Math.round(scaled));
		if (Number(text) < 1000 || i === units.length - 1) return `${text}${units[i]}`;
	}
	return String(value);
}

const colorOf = (series: ModelSeries, i: number): string => (series.other ? OTHER_COLOR : (PALETTE[i % PALETTE.length] ?? OTHER_COLOR));
const dayLabel = (day: string): string => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;

/** One stacked column per day, scaled to the busiest day; drops the oldest days when narrow. */
export function renderChart(summary: ModelsSummary, width: number, theme: ReportTheme): string[] {
	const totals = summary.days.map((_, d) => summary.series.reduce((sum, s) => sum + (s.daily[d] ?? 0), 0));
	const max = Math.max(0, ...totals);
	const top = formatUsd(max);
	const labelWidth = Math.max(top.length, 2);
	const gutter = labelWidth + 2;
	const area = width - gutter;
	if (area < 7) return [theme.fg("dim", "(widen the panel to see the chart)".slice(0, Math.max(0, width)))];

	// Column width and gap shrink with the panel; the last column needs no gap.
	const fits = (cw: number, gap: number) => area >= WINDOW_DAYS * (cw + gap) - gap;
	const [columnWidth, gap] = fits(3, 1) ? [3, 1] : fits(2, 1) ? [2, 1] : fits(1, 1) ? [1, 1] : [1, 0];
	const step = columnWidth + gap;
	const count = Math.min(WINDOW_DAYS, Math.floor((area + step - columnWidth) / step));
	const first = WINDOW_DAYS - count;

	// Per column: cumulative segment boundaries in eighths of a row, bottom first.
	const columns = Array.from({ length: count }, (_, c) => {
		const d = first + c;
		const total = totals[d] ?? 0;
		const height = total > 0 && max > 0 ? Math.max(1, Math.round((total / max) * UNITS)) : 0;
		let cum = 0;
		return summary.series.map((s) => {
			cum += s.daily[d] ?? 0;
			return total > 0 ? Math.round((cum / total) * height) : 0;
		});
	});

	const cell = (bounds: number[], row: number): string => {
		const height = bounds.at(-1) ?? 0;
		const fill = Math.min(8, Math.max(0, height - row * 8));
		if (fill === 0) return " ".repeat(columnWidth);
		const low = row * 8;
		let best = 0;
		let bestOverlap = -1;
		bounds.forEach((upper, i) => {
			const lower = i === 0 ? 0 : (bounds[i - 1] ?? 0);
			const overlap = Math.min(upper, low + fill) - Math.max(lower, low);
			if (overlap > bestOverlap) [best, bestOverlap] = [i, overlap];
		});
		const glyph = fill === 8 ? "█" : (PARTIAL[fill - 1] ?? "█");
		const series = summary.series[best];
		return series ? theme.fg(colorOf(series, best), glyph.repeat(columnWidth)) : glyph.repeat(columnWidth);
	};

	const lines: string[] = [];
	for (let r = CHART_ROWS - 1; r >= 0; r--) {
		const label = r === CHART_ROWS - 1 ? top : "";
		const axis = r === CHART_ROWS - 1 ? "┤" : "│";
		const cells = columns.map((bounds) => cell(bounds, r)).join(" ".repeat(step - columnWidth));
		lines.push(`${theme.fg("dim", `${label.padStart(labelWidth)} ${axis}`)}${cells}`);
	}
	const used = count * step - (step - columnWidth);
	lines.push(theme.fg("dim", `${"$0".padStart(labelWidth)} └${"─".repeat(used)}`));

	const every = [7, 14, 28].find((days) => days * step >= 7) ?? 28;
	const xs = new Array<string>(used).fill(" ");
	for (let c = 0; c < count; c += every) {
		const text = dayLabel(summary.days[first + c] ?? "");
		const x = c * step;
		if (x + text.length > used) break;
		for (let i = 0; i < text.length; i++) xs[x + i] = text[i]!;
	}
	lines.push(theme.fg("dim", `${" ".repeat(gutter)}${xs.join("").trimEnd()}`));
	return lines;
}

const truncate = (text: string, width: number): string => (text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text);

export function renderModels(summary: ModelsSummary, width: number, theme: ReportTheme): string[] {
	const note = theme.fg("dim", "Completed UTC days only · today is on the Quota tab");
	if (summary.series.length === 0) return [theme.fg("muted", "No activity in the last 30 days."), note];

	const lines: string[] = [];
	lines.push(`${theme.fg("muted", "Spend in last 30 days")}  ${theme.bold(formatUsd(summary.totalSpend))} · ${summary.totalRequests} requests`);
	lines.push(note);
	lines.push("");
	lines.push(theme.fg("muted", "Daily spend by model"));
	lines.push(...renderChart(summary, width, theme));

	const names = summary.series.map((s) => (s.byok ? `${s.name} (BYOK)` : s.name));
	const usd = summary.series.map((s) => formatUsd(s.stat.spend));
	const usdWidth = Math.max(...usd.map((u) => u.length));
	const reqWidth = Math.max(...summary.series.map((s) => String(s.stat.requests).length));
	const rankFixed = 2 + 2 + usdWidth + 2 + 4 + 2 + METER + 2 + reqWidth + 4;
	const tokenFixed = 2 + 2 + 7 + 2 + 10 + 2 + 9 + 2 + 7;
	const nameWidth = Math.min(Math.max(...names.map((n) => n.length)), Math.max(8, width - Math.max(rankFixed, tokenFixed)));
	const swatch = (i: number) => theme.fg(colorOf(summary.series[i]!, i), "■");
	const name = (i: number) => truncate(names[i]!, nameWidth).padEnd(nameWidth);

	lines.push("");
	lines.push(theme.fg("muted", "Ranking by model"));
	summary.series.forEach((s, i) => {
		const share = summary.totalSpend > 0 ? (s.stat.spend / summary.totalSpend) * 100 : 0;
		const filled = Math.min(METER, Math.round(share / 10));
		const meter = `${theme.fg(colorOf(s, i), "▰".repeat(filled))}${theme.fg("dim", "▱".repeat(METER - filled))}`;
		lines.push(`${swatch(i)} ${name(i)}  ${usd[i]!.padStart(usdWidth)}  ${`${Math.round(share)}%`.padStart(4)}  ${meter}  ${String(s.stat.requests).padStart(reqWidth)} ${theme.fg("dim", "req")}`);
	});

	lines.push("");
	lines.push(theme.fg("muted", "Tokens by model"));
	lines.push(theme.fg("dim", `  ${"".padEnd(nameWidth)}  ${"prompt".padStart(7)}  ${"completion".padStart(10)}  ${"reasoning".padStart(9)}  ${"cached".padStart(7)}`));
	summary.series.forEach((s, i) => {
		const { promptTokens, completionTokens, reasoningTokens, cachedTokens } = s.stat;
		lines.push(`${swatch(i)} ${name(i)}  ${formatCount(promptTokens).padStart(7)}  ${formatCount(completionTokens).padStart(10)}  ${formatCount(reasoningTokens).padStart(9)}  ${formatCount(cachedTokens).padStart(7)}`);
	});
	return lines;
}

export function renderMissingKey(theme: ReportTheme): string[] {
	return [
		theme.fg("warning", "The Models tab needs an OpenRouter management key."),
		`  1. Create one at ${theme.fg("accent", "https://openrouter.ai/settings/management-keys")}`,
		`  2. ${theme.fg("accent", `export ${MANAGEMENT_ENV_KEY}=...`)} and restart Pi`,
		theme.fg("dim", "It is only used for the read-only GET /api/v1/activity, and never stored or logged."),
	];
}
