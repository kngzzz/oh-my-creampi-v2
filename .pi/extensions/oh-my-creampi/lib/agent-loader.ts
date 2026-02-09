import * as fs from "node:fs";
import * as path from "node:path";

import type { AgentBackend, AgentProfile } from "./types";

export type AgentDiscoveryResult = {
	agents: AgentProfile[];
	agentsDir: string | null;
	warnings: string[];
};

function isDirectory(directoryPath: string): boolean {
	try {
		return fs.statSync(directoryPath).isDirectory();
	} catch {
		return false;
	}
}

function findNearestAgentsDir(cwd: string): string | null {
	let cursor = path.resolve(cwd);
	while (true) {
		const candidate = path.join(cursor, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;
		const parent = path.dirname(cursor);
		if (parent === cursor) return null;
		cursor = parent;
	}
}

function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
	const normalized = content.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) return { frontmatter: null, body: normalized };
	const endIndex = normalized.indexOf("\n---\n", 4);
	if (endIndex < 0) return { frontmatter: null, body: normalized };
	return {
		frontmatter: normalized.slice(4, endIndex),
		body: normalized.slice(endIndex + 5).trim(),
	};
}

function parseFrontmatter(raw: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const separator = trimmed.indexOf(":");
		if (separator <= 0) continue;
		const key = trimmed.slice(0, separator).trim();
		const valueRaw = trimmed.slice(separator + 1).trim();
		if (!key) continue;
		if (valueRaw.startsWith("[") && valueRaw.endsWith("]")) {
			out[key] = valueRaw
				.slice(1, -1)
				.split(",")
				.map((part) => part.trim())
				.filter(Boolean);
			continue;
		}
		if (valueRaw === "true") {
			out[key] = true;
			continue;
		}
		if (valueRaw === "false") {
			out[key] = false;
			continue;
		}
		const asNumber = Number(valueRaw);
		if (Number.isFinite(asNumber) && valueRaw !== "") {
			out[key] = asNumber;
			continue;
		}
		out[key] = valueRaw;
	}
	return out;
}

function parseBackend(value: unknown): AgentBackend | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === "pi" || normalized === "claude" || normalized === "codex") {
		return normalized;
	}
	return undefined;
}

function parseTools(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return [];
}

function loadAgentsFromDir(agentsDir: string, warnings: string[]): AgentProfile[] {
	const agents: AgentProfile[] = [];
	const entries = fs.readdirSync(agentsDir, { withFileTypes: true });

	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(agentsDir, entry.name);
		let content = "";
		try {
			content = fs.readFileSync(filePath, "utf8");
		} catch {
			warnings.push(`failed to read agent file: ${filePath}`);
			continue;
		}

		const split = splitFrontmatter(content);
		if (!split.frontmatter) {
			warnings.push(`missing frontmatter in ${filePath}`);
			continue;
		}
		const frontmatter = parseFrontmatter(split.frontmatter);

		const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
		const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
		if (!name || !description) {
			warnings.push(`agent requires name + description: ${filePath}`);
			continue;
		}

		agents.push({
			name,
			description,
			backend: parseBackend(frontmatter.backend) ?? "pi",
			tools: parseTools(frontmatter.tools),
			systemPrompt: split.body.trim(),
			provider: typeof frontmatter.provider === "string" ? frontmatter.provider : undefined,
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			source: "project",
			filePath,
		});
	}

	return agents;
}

export function discoverProjectAgentProfiles(cwd: string): AgentDiscoveryResult {
	const warnings: string[] = [];
	const agentsDir = findNearestAgentsDir(cwd);
	if (!agentsDir) return { agents: [], agentsDir: null, warnings };
	return {
		agents: loadAgentsFromDir(agentsDir, warnings),
		agentsDir,
		warnings,
	};
}
