import * as fs from "node:fs";
import * as path from "node:path";

import type { Severity } from "../types";
import { ensureDir } from "../util";

export type GuardrailEntry = {
	domain: string;
	lesson: string;
	severity: Severity;
	createdAt: string;
};

function normalizeDomain(domain: string): string {
	const normalized = domain.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
	if (!normalized) throw new Error("domain is required");
	return normalized;
}

function parseLine(domain: string, line: string): GuardrailEntry | undefined {
	const match = /^-\s+([^\s]+)\s+\[(info|warning|critical)\]\s+(.+)$/.exec(line.trim());
	if (!match) return undefined;
	const createdAt = match[1] ?? "";
	const severity = match[2] as Severity;
	const lesson = match[3]?.trim() ?? "";
	if (!lesson) return undefined;
	if (!Number.isFinite(Date.parse(createdAt))) return undefined;
	return { domain, lesson, severity, createdAt };
}

export class GuardrailMemory {
	private readonly dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	private filePathForDomain(domain: string): string {
		return path.join(this.dir, `${normalizeDomain(domain)}.md`);
	}

	async append(domain: string, lesson: string, severity: Severity = "info"): Promise<GuardrailEntry> {
		const normalizedDomain = normalizeDomain(domain);
		const normalizedLesson = lesson.trim();
		if (!normalizedLesson) throw new Error("lesson is required");
		const createdAt = new Date().toISOString();
		const entry: GuardrailEntry = {
			domain: normalizedDomain,
			lesson: normalizedLesson,
			severity,
			createdAt,
		};

		await ensureDir(this.dir);
		const filePath = this.filePathForDomain(normalizedDomain);
		const line = `- ${entry.createdAt} [${entry.severity}] ${entry.lesson}\n`;
		await fs.promises.appendFile(filePath, line, "utf8");
		return entry;
	}

	async list(domain: string, limit = 20): Promise<GuardrailEntry[]> {
		const normalizedDomain = normalizeDomain(domain);
		const filePath = this.filePathForDomain(normalizedDomain);
		try {
			const raw = await fs.promises.readFile(filePath, "utf8");
			const entries = raw
				.split(/\r?\n/)
				.map((line) => parseLine(normalizedDomain, line))
				.filter((entry): entry is GuardrailEntry => Boolean(entry));
			return entries.slice(-Math.max(0, limit));
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") return [];
			throw error;
		}
	}

	async renderForPrompt(domain: string, limit = 5): Promise<string | null> {
		const entries = await this.list(domain, limit);
		if (entries.length === 0) return null;
		const lines = ["# Guardrails", ...entries.map((entry) => `- [${entry.severity}] ${entry.lesson}`)];
		return lines.join("\n");
	}

	async countByDomain(): Promise<Record<string, number>> {
		await ensureDir(this.dir);
		const files = await fs.promises.readdir(this.dir);
		const counts: Record<string, number> = {};
		for (const file of files) {
			if (!file.endsWith(".md")) continue;
			const domain = file.slice(0, -3);
			const entries = await this.list(domain, Number.MAX_SAFE_INTEGER);
			counts[domain] = entries.length;
		}
		return counts;
	}
}
