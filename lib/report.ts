import { OPENROUTER_PROVIDER, type Budget, type KeyInfo, type UsageTotals } from "./openrouter.ts";
import { nextReset } from "./usage-source.ts";

// The /openrouter detail: dollars, usage totals and threshold alerts, the parts
// gentle-shell's percent-only alt+u view cannot show. Pure: the extension owns
// fetching, rendering into the TUI and notifying.

export const THRESHOLD_ENV = "OPENROUTER_QUOTA_ALERT_PERCENT";
export const DEFAULT_THRESHOLD = 80;
const LABEL_WIDTH = 13;

export interface ReportTheme {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

export interface Alert {
	level: "warning" | "error";
	message: string;
}

/** 1-100 enables alerts at that usage percent, 0 disables them; anything else falls back to the default. */
export function parseThreshold(value: string | undefined): number {
	if (value === undefined || value.trim() === "") return DEFAULT_THRESHOLD;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : DEFAULT_THRESHOLD;
}

export function formatUsd(value: number): string {
	const abs = Math.abs(value);
	const digits = abs > 0 && abs < 0.01 ? 4 : 2;
	return `${value < 0 ? "-" : ""}$${abs.toFixed(digits)}`;
}

function formatIn(target: number, now: number): string {
	const seconds = Math.max(0, Math.floor((target - now) / 1000));
	if (seconds === 0) return "now";
	const d = Math.floor(seconds / 86_400);
	const h = Math.floor((seconds % 86_400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `in ${d}d ${h}h`;
	if (h > 0) return `in ${h}h ${m}m`;
	return `in ${m}m`;
}

function resetText(interval: string | null, resetsAt: number | null, now: number): string {
	const at = resetsAt ?? nextReset(interval, now);
	if (!interval && at === null) return "never resets";
	const when = at === null ? "" : `resets ${formatIn(at, now)}`;
	return [interval, when].filter(Boolean).join(", ");
}

function pct(used: number, limit: number): number {
	if (limit <= 0) return used > 0 ? 100 : 0;
	return (used / limit) * 100;
}

function paintPercent(theme: ReportTheme, value: number, threshold: number): string {
	const text = `${Math.round(value)}%`;
	if (value >= 100) return theme.fg("error", text);
	if (threshold > 0 && value >= threshold) return theme.fg("warning", text);
	return theme.fg("text", text);
}

function spendLine(theme: ReportTheme, used: number, limit: number, left: number, threshold: number): string {
	return `${formatUsd(used)} of ${formatUsd(limit)} used (${paintPercent(theme, pct(used, limit), threshold)}) · ${formatUsd(left)} left`;
}

function totalsLine(totals: UsageTotals): string {
	const parts: string[] = [];
	if (totals.daily !== null) parts.push(`today ${formatUsd(totals.daily)}`);
	if (totals.weekly !== null) parts.push(`week ${formatUsd(totals.weekly)}`);
	if (totals.monthly !== null) parts.push(`month ${formatUsd(totals.monthly)}`);
	parts.push(`all time ${formatUsd(totals.total)}`);
	return parts.join(" · ");
}

const scopeName = (budget: Budget): string => budget.scope.replace(/_/g, " ");
const sameBudget = (a: Budget, b: Budget | null): boolean =>
	!!b && a.scope === b.scope && a.limitUsd === b.limitUsd && a.spendUsd === b.spendUsd && a.resetsAt === b.resetsAt;

export function renderReport(info: KeyInfo, now: number, threshold: number, theme: ReportTheme): string[] {
	const label = (text: string): string => theme.fg("muted", text.padEnd(LABEL_WIDTH));
	const lines: string[] = [];
	const plan = info.isFreeTier ? "free tier" : "paid";
	lines.push([theme.bold(theme.fg("accent", "OpenRouter")), info.label, theme.fg("muted", plan)].filter(Boolean).join(" · "));

	if (info.keyLimit) {
		const { limit, remaining, reset } = info.keyLimit;
		lines.push(`${label("Key limit")}${spendLine(theme, limit - remaining, limit, remaining, threshold)} · ${theme.fg("dim", resetText(reset, null, now))}`);
	} else {
		lines.push(`${label("Key limit")}unlimited`);
	}

	if (info.budgets.length > 0) {
		lines.push(theme.fg("muted", "Budgets"));
		const width = Math.max(...info.budgets.map((b) => scopeName(b).length)) + 2;
		for (const budget of info.budgets) {
			const first = sameBudget(budget, info.effectiveBudget) ? ` · ${theme.fg("warning", "blocks first")}` : "";
			lines.push(`  ${scopeName(budget).padEnd(width)}${spendLine(theme, budget.spendUsd, budget.limitUsd, budget.remainingUsd, threshold)} · ${theme.fg("dim", resetText(budget.resetInterval, budget.resetsAt, now))}${first}`);
		}
	}

	lines.push(`${label("Usage")}${totalsLine(info.usage)}`);
	if (info.byokUsage) lines.push(`${label("BYOK")}${totalsLine(info.byokUsage)}`);

	if (info.freeRequests) {
		const { used, limit, remaining } = info.freeRequests;
		lines.push(`${label("Free models")}${used} of ${limit} requests today (${paintPercent(theme, pct(used, limit), threshold)}) · ${remaining} left · ${theme.fg("dim", resetText(null, nextReset("daily", now), now))}`);
	}

	lines.push(theme.fg("dim", `${threshold > 0 ? `Alerts at ${threshold}%` : "Alerts off"} · refresh with /${OPENROUTER_PROVIDER}`));
	return lines;
}

function check(name: string, used: number, limit: number, remaining: number, left: string, threshold: number): Alert | undefined {
	if (remaining <= 0) return { level: "error", message: `OpenRouter ${name} exhausted (${left})` };
	const value = pct(used, limit);
	if (value >= threshold) return { level: "warning", message: `OpenRouter ${name} at ${Math.round(value)}% (${left})` };
	return undefined;
}

export function findAlerts(info: KeyInfo, threshold: number): Alert[] {
	if (threshold <= 0) return [];
	const alerts: (Alert | undefined)[] = [];
	for (const budget of info.budgets) {
		if (budget.scope === "key_limit" && info.keyLimit) continue;
		alerts.push(check(`${scopeName(budget)} budget`, budget.spendUsd, budget.limitUsd, budget.remainingUsd, `${formatUsd(budget.remainingUsd)} left`, threshold));
	}
	if (info.keyLimit) {
		const { limit, remaining } = info.keyLimit;
		alerts.push(check("key limit", limit - remaining, limit, remaining, `${formatUsd(remaining)} left`, threshold));
	}
	if (info.freeRequests) {
		const { used, limit, remaining } = info.freeRequests;
		alerts.push(check("free model requests", used, limit, remaining, `${remaining} left today`, threshold));
	}
	return alerts.filter((alert): alert is Alert => alert !== undefined);
}
