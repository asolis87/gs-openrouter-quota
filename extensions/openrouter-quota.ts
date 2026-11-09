import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createUsageSource, USAGE_SOURCE_EVENT } from "../lib/usage-source.ts";

export default function openrouterQuota(pi: ExtensionAPI): void {
	// Re-emitting on every session_start is safe: gentle-shell keeps the newest
	// source per provider. Without gentle-shell installed nobody listens.
	pi.on("session_start", () => {
		pi.events.emit(USAGE_SOURCE_EVENT, createUsageSource(process.env));
	});
}
