import type { ActivityResult } from "./activity.ts";
import { renderMissingKey, renderModels, summarizeActivity, type ModelsSummary } from "./models-report.ts";
import type { FetchResult, KeyInfo } from "./openrouter.ts";
import { findAlerts, renderReport, type Alert, type ReportTheme } from "./report.ts";

// The /openrouter overlay: the same framed look as Gentle Shell's alt+u
// panel (╭─ title ─╮, r refresh, esc close), drawn around two tabs: the dollar
// report (Quota) and spend per model (Models).
// Width math is injected (`fit`) so this stays free of TUI imports and testable.

export interface QuotaViewDeps {
	theme: ReportTheme;
	/** Pad or truncate (ANSI-aware) to exactly `width` visible columns. */
	fit(text: string, width: number): string;
	now(): number;
	threshold: number;
	load(): Promise<FetchResult>;
	/** Models tab data; fetched the first time the tab opens and on `r` there. */
	loadActivity?(): Promise<ActivityResult>;
	onAlerts(alerts: Alert[]): void;
	onClose(): void;
	requestRender(): void;
	/** The TUI's escape matcher; terminals with extended keyboard protocols do not send a bare ESC byte. */
	isEscape?(data: string): boolean;
	/** The TUI's tab matcher, for the same reason. */
	isTab?(data: string): boolean;
}

type Tab = "quota" | "models";

const TITLE = "✿ OpenRouter";
const REFRESHING = "✿ OpenRouter · refreshing…";
const TABS: readonly { id: Tab; label: string }[] = [
	{ id: "quota", label: "Quota" },
	{ id: "models", label: "Models" },
];
const ESCAPE = "\u001b";
const TAB = "\t";

interface Pane<T> {
	data: T | undefined;
	fetchedAt: number;
	error: string | undefined;
	missingKey: boolean;
	loading: boolean;
	started: boolean;
}

const pane = <T>(): Pane<T> => ({ data: undefined, fetchedAt: 0, error: undefined, missingKey: false, loading: false, started: false });

export class QuotaView {
	private readonly deps: QuotaViewDeps;
	private tab: Tab = "quota";
	private readonly quota: Pane<KeyInfo> = pane();
	private readonly models: Pane<ModelsSummary> = pane();

	constructor(deps: QuotaViewDeps) {
		this.deps = deps;
	}

	handleInput(data: string): void {
		const isEscape = this.deps.isEscape ?? ((input: string) => input === ESCAPE);
		const isTab = this.deps.isTab ?? ((input: string) => input === TAB);
		if (isEscape(data) || data === "q") {
			this.deps.onClose();
			return;
		}
		if (isTab(data)) {
			this.tab = this.tab === "quota" ? "models" : "quota";
			if (this.tab === "models" && !this.models.started) this.refreshModels();
			else this.deps.requestRender();
			return;
		}
		if (data === "r") {
			if (this.tab === "quota") this.refresh();
			else this.refreshModels();
		}
	}

	/** Refreshes the Quota tab; the only fetch that raises alerts. */
	refresh(): void {
		this.run(this.quota, () => this.deps.load(), (result) => {
			if (!result.ok) return { error: result.error };
			this.deps.onAlerts(findAlerts(result.info, this.deps.threshold));
			return { data: result.info };
		});
	}

	refreshModels(): void {
		const load = this.deps.loadActivity ?? (async (): Promise<ActivityResult> => ({ ok: false, error: "Models are not available here." }));
		this.run(this.models, load, (result) => {
			if (!result.ok) return { error: result.error, missingKey: result.missingKey === true };
			return { data: summarizeActivity(result.rows, this.deps.now()) };
		});
	}

	// Never lets a rejection escape: an unhandled rejection would take the TUI down.
	private run<T, R>(target: Pane<T>, load: () => Promise<R>, apply: (result: R) => { data?: T; error?: string; missingKey?: boolean }): void {
		if (target.loading) return;
		target.loading = true;
		target.started = true;
		this.deps.requestRender();
		const settle = (outcome: { data?: T; error?: string; missingKey?: boolean }) => {
			target.loading = false;
			if (outcome.data !== undefined) {
				target.data = outcome.data;
				target.fetchedAt = this.deps.now();
				target.error = undefined;
				target.missingKey = false;
			} else {
				target.error = outcome.error;
				target.missingKey = outcome.missingKey === true;
			}
			this.deps.requestRender();
		};
		const fail = (error: unknown) => settle({ error: error instanceof Error ? error.message : String(error) });
		try {
			load().then((result) => {
				try {
					settle(apply(result));
				} catch (error) {
					fail(error);
				}
			}, fail);
		} catch (error) {
			fail(error);
		}
	}

	render(width: number): string[] {
		const { theme, fit } = this.deps;
		const inner = Math.max(4, width - 2);
		const frame = (text: string) => theme.fg("border", text);
		const row = (text: string) => `${frame("│")} ${fit(text, inner - 2)} ${frame("│")}`;
		const active = this.tab === "quota" ? this.quota : this.models;
		const title = active.loading ? REFRESHING : TITLE;
		const tabsText = TABS.map((t) => t.label).join(" · ");
		const tabs = TABS.map((t) => (t.id === this.tab ? theme.bold(theme.fg("accent", t.label)) : theme.fg("muted", t.label))).join(theme.fg("dim", " · "));
		const rest = Math.max(0, inner - title.length - tabsText.length - 6);
		const top = `${frame("╭─ ")}${theme.fg("customMessageLabel", title)}${frame(" ─ ")}${tabs}${frame(` ${"─".repeat(rest)}╮`)}`;

		const body: string[] = [];
		const content = inner - 2;
		if (this.tab === "quota") {
			if (this.quota.data) body.push(...renderReport(this.quota.data, this.quota.fetchedAt, this.deps.threshold, theme, { framed: true }));
			else if (this.quota.loading) body.push(theme.fg("dim", "Fetching OpenRouter quota…"));
			if (this.quota.error) body.push(theme.fg("error", this.quota.error));
		} else {
			if (this.models.data) body.push(...renderModels(this.models.data, content, theme));
			else if (this.models.loading) body.push(theme.fg("dim", "Fetching OpenRouter activity…"));
			if (this.models.missingKey) body.push(...renderMissingKey(theme));
			else if (this.models.error) body.push(theme.fg("error", this.models.error));
		}

		const hint = (key: string, label: string) => `${theme.fg("accent", key)} ${theme.fg("dim", label)}`;
		const keys = [hint("tab", "switch"), hint("r", "refresh"), hint("esc", "close")].join("   ");
		return [top, ...body.map(row), row(keys), frame(`╰${"─".repeat(inner)}╯`)];
	}

	invalidate(): void {}
}
