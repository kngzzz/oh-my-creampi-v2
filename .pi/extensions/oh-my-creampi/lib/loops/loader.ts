import * as fs from "node:fs";
import * as path from "node:path";

import type { AgentBackend } from "../types";
import type { LoopDefinition, LoopDiscoveryResult, LoopTriggerDefinition, LoopTriggerType } from "./types";

function isDirectory(directoryPath: string): boolean {
	try {
		return fs.statSync(directoryPath).isDirectory();
	} catch {
		return false;
	}
}

function asObject(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function asString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized || undefined;
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
	const number = asNumber(value);
	if (number === undefined) return fallback;
	return Math.max(min, Math.min(max, Math.floor(number)));
}

function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
	const normalized = content.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) return { frontmatter: null, body: normalized };
	const end = normalized.indexOf("\n---\n", 4);
	if (end < 0) return { frontmatter: null, body: normalized };
	return {
		frontmatter: normalized.slice(4, end),
		body: normalized.slice(end + 5),
	};
}

function parseScalar(raw: string): unknown {
	const value = raw.trim();
	if (!value) return "";
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (value.startsWith("[") && value.endsWith("]")) {
		return value
			.slice(1, -1)
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
	}
	const asNumeric = Number(value);
	if (Number.isFinite(asNumeric)) return asNumeric;
	return value;
}

function parseYamlLike(raw: string): Record<string, unknown> {
	type Frame = { indent: number; value: Record<string, unknown> | unknown[] };
	const root: Record<string, unknown> = {};
	const stack: Frame[] = [{ indent: -1, value: root }];
	const lines = raw.replace(/\r\n/g, "\n").split("\n");

	const peekNextMeaningful = (start: number): { indent: number; value: string } | undefined => {
		for (let index = start; index < lines.length; index += 1) {
			const line = lines[index] ?? "";
			if (!line.trim() || line.trim().startsWith("#")) continue;
			return {
				indent: line.length - line.trimStart().length,
				value: line.trim(),
			};
		}
		return undefined;
	};

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (!line.trim() || line.trim().startsWith("#")) continue;

		const indent = line.length - line.trimStart().length;
		const trimmed = line.trim();

		while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
			stack.pop();
		}

		const parent = stack[stack.length - 1]!.value;

		if (trimmed.startsWith("- ")) {
			if (!Array.isArray(parent)) continue;
			const itemRaw = trimmed.slice(2).trim();
			if (!itemRaw) {
				const nested: Record<string, unknown> = {};
				parent.push(nested);
				stack.push({ indent, value: nested });
				continue;
			}
			const colonIndex = itemRaw.indexOf(":");
			if (colonIndex > 0) {
				const key = itemRaw.slice(0, colonIndex).trim();
				const valueRaw = itemRaw.slice(colonIndex + 1).trim();
				const nested: Record<string, unknown> = {};
				if (!valueRaw) {
					const next = peekNextMeaningful(index + 1);
					const container: Record<string, unknown> | unknown[] =
						next && next.indent > indent && next.value.startsWith("- ") ? [] : {};
					nested[key] = container;
					parent.push(nested);
					stack.push({ indent, value: nested });
					stack.push({ indent: indent + 1, value: container });
				} else {
					nested[key] = parseScalar(valueRaw);
					parent.push(nested);
				}
				continue;
			}
			parent.push(parseScalar(itemRaw));
			continue;
		}

		const colonIndex = trimmed.indexOf(":");
		if (colonIndex <= 0 || Array.isArray(parent)) continue;
		const key = trimmed.slice(0, colonIndex).trim();
		const valueRaw = trimmed.slice(colonIndex + 1).trim();
		if (!valueRaw) {
			const next = peekNextMeaningful(index + 1);
			const container: Record<string, unknown> | unknown[] =
				next && next.indent > indent && next.value.startsWith("- ") ? [] : {};
			parent[key] = container;
			stack.push({ indent, value: container });
			continue;
		}
		parent[key] = parseScalar(valueRaw);
	}

	return root;
}

function parseBackend(value: unknown, warnings: string[], filePath: string): AgentBackend {
	const backend = asString(value)?.toLowerCase();
	if (!backend) return "pi";
	if (backend === "pi" || backend === "claude" || backend === "codex") return backend;
	warnings.push(`invalid loop backend in ${filePath}: ${backend}`);
	return "pi";
}

function parseTriggerType(value: unknown): LoopTriggerType {
	const type = asString(value)?.toLowerCase();
	if (type === "cron" || type === "event" || type === "manual") return type;
	return "manual";
}

function parseTrigger(frontmatter: Record<string, unknown>): LoopTriggerDefinition {
	const trigger = asObject(frontmatter.trigger);
	return {
		type: parseTriggerType(trigger.type),
		schedule: asString(trigger.schedule),
		event: asString(trigger.event),
		source: asString(trigger.source),
	};
}

function findNearestLoopsDir(cwd: string): string | null {
	let cursor = path.resolve(cwd);
	while (true) {
		const candidate = path.join(cursor, ".pi", "loops");
		if (isDirectory(candidate)) return candidate;
		const parent = path.dirname(cursor);
		if (parent === cursor) return null;
		cursor = parent;
	}
}

function parseLoopFile(filePath: string, warnings: string[]): LoopDefinition | null {
	let content = "";
	try {
		content = fs.readFileSync(filePath, "utf8");
	} catch {
		warnings.push(`failed to read loop file: ${filePath}`);
		return null;
	}

	const split = splitFrontmatter(content);
	if (!split.frontmatter) {
		warnings.push(`missing frontmatter in loop file: ${filePath}`);
		return null;
	}

	const frontmatter = parseYamlLike(split.frontmatter);
	const name = asString(frontmatter.name);
	if (!name) {
		warnings.push(`loop missing name: ${filePath}`);
		return null;
	}

	const budgetRaw = asObject(frontmatter.budget);
	const evalRaw = asObject(frontmatter.eval);
	const inputs = asObject(frontmatter.inputs);

	const evalType = asString(evalRaw.type);
	if (evalType && evalType !== "exit_code") {
		warnings.push(`unsupported eval type in ${filePath}: ${evalType}; using exit_code`);
	}

	return {
		name,
		version: asInt(frontmatter.version, 1, 1, 1_000),
		description: asString(frontmatter.description) ?? `Loop: ${name}`,
		trigger: parseTrigger(frontmatter),
		agent: asString(frontmatter.agent) ?? "sisyphus",
		backend: parseBackend(frontmatter.backend, warnings, filePath),
		timeoutSec: asInt(frontmatter.timeout, 120, 0, 86_400),
		maxConcurrent: asInt(frontmatter.max_concurrent, 1, 1, 32),
		cooldownSec: asInt(frontmatter.cooldown, 0, 0, 86_400),
		maxRetries: asInt(frontmatter.max_retries, 0, 0, 16),
		inputs,
		budget: {
			maxTokens: asNumber(budgetRaw.maxTokens ?? budgetRaw.max_tokens),
			maxCostUsd: asNumber(budgetRaw.maxCostUsd ?? budgetRaw.max_cost_usd),
			maxDurationSec: asNumber(budgetRaw.maxDurationSec ?? budgetRaw.max_duration_sec),
		},
		eval: {
			type: "exit_code",
			passCondition: asInt(evalRaw.pass_condition, 0, -9999, 9999),
			blocking: typeof evalRaw.blocking === "boolean" ? evalRaw.blocking : true,
		},
		shouldRun: asString(frontmatter.should_run) ?? asString(frontmatter.run_if),
		promptTemplate: split.body.trim(),
		filePath,
		updatedAt: fs.statSync(filePath).mtimeMs,
	};
}

export function discoverProjectLoopDefinitions(cwd: string): LoopDiscoveryResult {
	const warnings: string[] = [];
	const loopsDir = findNearestLoopsDir(cwd);
	if (!loopsDir) {
		return {
			loops: [],
			loopsDir: null,
			warnings,
		};
	}

	const loops: LoopDefinition[] = [];
	const seen = new Set<string>();
	const entries = fs.readdirSync(loopsDir, { withFileTypes: true });
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		const filePath = path.join(loopsDir, entry.name);
		const loop = parseLoopFile(filePath, warnings);
		if (!loop) continue;
		if (seen.has(loop.name)) {
			warnings.push(`duplicate loop name: ${loop.name}`);
			continue;
		}
		seen.add(loop.name);
		loops.push(loop);
	}

	return {
		loops,
		loopsDir,
		warnings,
	};
}
