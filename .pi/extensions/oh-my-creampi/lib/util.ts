import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function formatDurationMs(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0s";
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

export function nowIso(): string {
	return new Date().toISOString();
}

export function toErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function createId(prefix: string): string {
	return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function ensureDirSync(dirPath: string): void {
	fs.mkdirSync(dirPath, { recursive: true });
}

export async function ensureDir(dirPath: string): Promise<void> {
	await fs.promises.mkdir(dirPath, { recursive: true });
}

export async function readTextIfExists(filePath: string): Promise<string | null> {
	try {
		return await fs.promises.readFile(filePath, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return null;
		throw error;
	}
}

export function stableStringify(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).sort();
		const body = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",");
		return `{${body}}`;
	}
	return JSON.stringify(String(value));
}

export function sha256Hex(value: unknown): string {
	return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function findUp(startDir: string, relativePath: string): string | null {
	let current = path.resolve(startDir);
	while (true) {
		const candidate = path.join(current, relativePath);
		if (fs.existsSync(candidate)) return candidate;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export async function readKernelAwareness(projectRoot: string): Promise<string> {
	const awarenessPath = path.join(projectRoot, ".pi", "kernel-awareness.md");
	try {
		return (await fs.promises.readFile(awarenessPath, "utf8")).trim();
	} catch {
		return "";
	}
}

export function composeKernelPrompt(kernelAwareness: string, guardrails: string, prompt: string): string {
	const sections = [
		kernelAwareness ? `## Kernel Awareness\n${kernelAwareness}` : "",
		guardrails ? `## Guardrails (lessons from past runs)\n${guardrails}` : "",
		"---",
		prompt,
	].filter((s) => s.trim().length > 0);
	return sections.join("\n\n");
}

export function renderTemplate(template: string, context: Record<string, unknown>): string {
	return template.replace(/\{([^{}]+)\}/g, (match, keyRaw: string) => {
		const key = keyRaw.trim();
		if (!key) return match;
		const value = key.split(".").reduce<unknown>((cursor, part) => {
			if (!cursor || typeof cursor !== "object") return undefined;
			return (cursor as Record<string, unknown>)[part];
		}, context);
		if (value === undefined || value === null) return match;
		if (typeof value === "string") return value;
		if (typeof value === "number" || typeof value === "boolean") return String(value);
		return JSON.stringify(value);
	});
}
