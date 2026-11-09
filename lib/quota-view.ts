import type { FetchResult, KeyInfo } from "./openrouter.ts";
import { findAlerts, renderReport, type Alert, type ReportTheme } from "./report.ts";

// The /openrouter overlay: the same framed look as Gentle Shell's alt+u
// panel (╭─ title ─╮, r refresh, esc close), drawn around the dollar report.
// Width math is injected (`fit`) so this stays free of TUI imports and testable.

export interface QuotaViewDeps {
	theme: ReportTheme;
	/** Pad or truncate (ANSI-aware) to exactly `width` visible columns. */
	fit(text: string, width: number): string;
	now(): number;
	threshold: number;
	load(): Promise<FetchResult>;
	onAlerts(alerts: Alert[]): void;
	onClose(): void;
	requestRender(): void;
}

const TITLE = "✿ OpenRouter";
const REFRESHING = "✿ OpenRouter · refreshing…";
const ESCAPE = "\u001b";

export class QuotaView {
	private readonly deps: QuotaViewDeps;
	private info: KeyInfo | undefined;
	private fetchedAt = 0;
	private error: string | undefined;
	private loading = false;

	constructor(deps: QuotaViewDeps) {
		this.deps = deps;
	}

	handleInput(data: string): void {
		if (data === ESCAPE || data === "q") {
			this.deps.onClose();
			return;
		}
		if (data === "r") this.refresh();
	}

	// Never lets a rejection escape: an unhandled rejection would take the TUI down.
	refresh(): void {
		if (this.loading) return;
		this.loading = true;
		this.deps.requestRender();
		const settle = (result: FetchResult) => {
			this.loading = false;
			if (result.ok) {
				this.info = result.info;
				this.fetchedAt = this.deps.now();
				this.error = undefined;
				this.deps.onAlerts(findAlerts(result.info, this.deps.threshold));
			} else {
				this.error = result.error;
			}
			this.deps.requestRender();
		};
		const fail = (error: unknown) => settle({ ok: false, error: error instanceof Error ? error.message : String(error) });
		try {
			this.deps.load().then(settle, fail);
		} catch (error) {
			fail(error);
		}
	}

	render(width: number): string[] {
		const { theme, fit } = this.deps;
		const inner = Math.max(4, width - 2);
		const frame = (text: string) => theme.fg("border", text);
		const row = (text: string) => `${frame("│")} ${fit(text, inner - 2)} ${frame("│")}`;
		const title = this.loading ? REFRESHING : TITLE;
		const top = `${frame("╭─ ")}${theme.fg("customMessageLabel", title)}${frame(` ${"─".repeat(Math.max(0, inner - title.length - 3))}╮`)}`;

		const body: string[] = [];
		if (this.info) body.push(...renderReport(this.info, this.fetchedAt, this.deps.threshold, theme, { framed: true }));
		else if (this.loading) body.push(theme.fg("dim", "Fetching OpenRouter quota…"));
		if (this.error) body.push(theme.fg("error", this.error));

		const keys = `${theme.fg("accent", "r")} ${theme.fg("dim", "refresh")}   ${theme.fg("accent", "esc")} ${theme.fg("dim", "close")}`;
		return [top, ...body.map(row), row(keys), frame(`╰${"─".repeat(inner)}╯`)];
	}

	invalidate(): void {}
}
