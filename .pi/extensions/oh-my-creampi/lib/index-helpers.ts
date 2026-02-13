import * as path from "node:path";

import type { ExtensionAPI, ToolExecuteContext, ToolResult } from "./types";

export function textResult(text: string, details?: Record<string, unknown>, isError = false): ToolResult {
	return {
		content: [{ type: "text", text }],
		details,
		isError,
	};
}

export function resolveStoragePath(root: string, value: string): string {
	return path.isAbsolute(value) ? value : path.join(root, value);
}

export function asString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized || undefined;
}

export function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

export async function checkCli(
	pi: ExtensionAPI,
	ctx: ToolExecuteContext,
	bin: string,
	args: string[],
): Promise<{ ready: boolean; detail: string }> {
	if (!pi.exec) {
		return { ready: false, detail: "extension api does not expose exec()" };
	}
	try {
		const result = await pi.exec(bin, args, { cwd: ctx.cwd, timeout: 12_000 });
		if (result.code === 0) {
			return { ready: true, detail: result.stdout.trim() || "ok" };
		}
		return { ready: false, detail: result.stderr.trim() || `exit ${result.code}` };
	} catch (error) {
		return { ready: false, detail: error instanceof Error ? error.message : String(error) };
	}
}
