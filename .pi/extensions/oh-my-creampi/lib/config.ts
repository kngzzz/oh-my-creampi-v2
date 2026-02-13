import * as fs from "node:fs";
import * as path from "node:path";

import type { AgentBackend, CreamPiConfig, CreamPiBackendConfig } from "./types";
import { findUp } from "./util";

export type LoadedConfig = {
	config: CreamPiConfig;
	path: string | null;
	warnings: string[];
};

const DEFAULT_BACKENDS: Record<AgentBackend, CreamPiBackendConfig> = {
	pi: { provider: "openai-codex", model: "gpt-5.3-codex" },
	claude: { provider: "anthropic", model: "claude-opus-4-6" },
	codex: { provider: "openai-codex", model: "codex-5.3" },
};

export const DEFAULT_CONFIG: CreamPiConfig = {
	defaultAgent: "sisyphus",
	defaultBackend: "pi",
	defaultModel: "gpt-5.3-codex",
	maxConcurrency: 3,
	defaultTimeoutSec: 300,
	worktree: {
		enabled: false,
		dir: ".creampi/worktrees",
		branchPrefix: "creampi/",
		cleanup: "on-finish",
	},
	guardrailsDir: ".creampi/guardrails",
	idempotencyDir: ".creampi/idempotency",
	idempotencyTtlSec: 600,
	checkpointsDir: ".creampi/checkpoints",
	backends: {
		pi: DEFAULT_BACKENDS.pi,
		claude: DEFAULT_BACKENDS.claude,
		codex: DEFAULT_BACKENDS.codex,
	},
};

function stripJsonComments(text: string): string {
	let output = "";
	let inString = false;
	let stringQuote: '"' | "'" | "" = "";
	let inLineComment = false;
	let inBlockComment = false;
	let escaped = false;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index] ?? "";
		const next = text[index + 1] ?? "";

		if (inLineComment) {
			if (char === "\n") {
				inLineComment = false;
				output += char;
			}
			continue;
		}

		if (inBlockComment) {
			if (char === "*" && next === "/") {
				inBlockComment = false;
				index += 1;
			}
			continue;
		}

		if (inString) {
			output += char;
			if (!escaped && char === "\\") {
				escaped = true;
				continue;
			}
			if (!escaped && char === stringQuote) {
				inString = false;
				stringQuote = "";
			}
			escaped = false;
			continue;
		}

		if (char === '"' || char === "'") {
			inString = true;
			stringQuote = char;
			output += char;
			continue;
		}

		if (char === "/" && next === "/") {
			inLineComment = true;
			index += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			inBlockComment = true;
			index += 1;
			continue;
		}

		output += char;
	}

	return output;
}

function parseConfig(raw: string): unknown {
	const cleaned = stripJsonComments(raw);
	return JSON.parse(cleaned);
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

function asInteger(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isInteger(parsed)) return parsed;
	}
	return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		if (value === "true") return true;
		if (value === "false") return false;
	}
	return undefined;
}

function sanitizeBackend(
	backend: AgentBackend,
	value: unknown,
	warnings: string[],
): CreamPiBackendConfig {
	const record = asObject(value);
	const provider = asString(record.provider);
	const model = asString(record.model);
	if (!provider || !model) {
		if (value !== undefined) {
			warnings.push(`invalid backend config for ${backend}; using defaults`);
		}
		return DEFAULT_BACKENDS[backend];
	}
	return { provider, model };
}

export function loadCreamPiConfig(cwd: string): LoadedConfig {
	const warnings: string[] = [];
	const configPath =
		findUp(cwd, path.join(".pi", "oh-my-creampi.jsonc")) ??
		findUp(cwd, path.join(".pi", "oh-my-creampi.json"));

	if (!configPath) {
		return {
			config: DEFAULT_CONFIG,
			path: null,
			warnings,
		};
	}

	let raw = "";
	try {
		raw = fs.readFileSync(configPath, "utf8");
	} catch (error) {
		warnings.push(`failed to read config: ${error instanceof Error ? error.message : String(error)}`);
		return {
			config: DEFAULT_CONFIG,
			path: configPath,
			warnings,
		};
	}

	let parsed: unknown;
	try {
		parsed = parseConfig(raw);
	} catch (error) {
		warnings.push(`failed to parse config: ${error instanceof Error ? error.message : String(error)}`);
		return {
			config: DEFAULT_CONFIG,
			path: configPath,
			warnings,
		};
	}

	const root = asObject(parsed);
	const defaultBackendRaw = asString(root.defaultBackend)?.toLowerCase();
	const defaultBackend: AgentBackend =
		defaultBackendRaw === "pi" || defaultBackendRaw === "claude" || defaultBackendRaw === "codex"
			? defaultBackendRaw
			: DEFAULT_CONFIG.defaultBackend;
	if (defaultBackendRaw && defaultBackendRaw !== defaultBackend) {
		warnings.push(`invalid defaultBackend: ${defaultBackendRaw}; using ${DEFAULT_CONFIG.defaultBackend}`);
	}

	const maxConcurrencyRaw = asInteger(root.maxConcurrency);
	const maxConcurrency =
		maxConcurrencyRaw !== undefined && maxConcurrencyRaw >= 1 && maxConcurrencyRaw <= 32
			? maxConcurrencyRaw
			: DEFAULT_CONFIG.maxConcurrency;
	if (maxConcurrencyRaw !== undefined && maxConcurrencyRaw !== maxConcurrency) {
		warnings.push(`maxConcurrency must be 1..32; using ${DEFAULT_CONFIG.maxConcurrency}`);
	}

	const timeoutRaw = asInteger(root.defaultTimeoutSec);
	const defaultTimeoutSec =
		timeoutRaw !== undefined && timeoutRaw >= 0 && timeoutRaw <= 86_400
			? timeoutRaw
			: DEFAULT_CONFIG.defaultTimeoutSec;
	if (timeoutRaw !== undefined && timeoutRaw !== defaultTimeoutSec) {
		warnings.push(`defaultTimeoutSec must be 0..86400; using ${DEFAULT_CONFIG.defaultTimeoutSec}`);
	}

	const idempotencyTtlRaw = asInteger(root.idempotencyTtlSec);
	const idempotencyTtlSec =
		idempotencyTtlRaw !== undefined && idempotencyTtlRaw > 0 && idempotencyTtlRaw <= 86_400
			? idempotencyTtlRaw
			: DEFAULT_CONFIG.idempotencyTtlSec;
	if (idempotencyTtlRaw !== undefined && idempotencyTtlRaw !== idempotencyTtlSec) {
		warnings.push(`idempotencyTtlSec must be 1..86400; using ${DEFAULT_CONFIG.idempotencyTtlSec}`);
	}

	const backendRoot = asObject(root.backends);
	const worktreeRoot = asObject(root.worktree);
	const cleanupRaw = asString(worktreeRoot.cleanup);
	const cleanup =
		cleanupRaw === "never" || cleanupRaw === "on-success" || cleanupRaw === "on-finish"
			? cleanupRaw
			: DEFAULT_CONFIG.worktree.cleanup;
	if (cleanupRaw && cleanupRaw !== cleanup) {
		warnings.push(`worktree.cleanup must be never|on-success|on-finish; using ${DEFAULT_CONFIG.worktree.cleanup}`);
	}

	const config: CreamPiConfig = {
		defaultAgent: asString(root.defaultAgent) ?? DEFAULT_CONFIG.defaultAgent,
		defaultBackend,
		defaultModel: asString(root.defaultModel) ?? DEFAULT_CONFIG.defaultModel,
		maxConcurrency,
		defaultTimeoutSec,
		worktree: {
			enabled: asBoolean(worktreeRoot.enabled) ?? DEFAULT_CONFIG.worktree.enabled,
			dir: asString(worktreeRoot.dir) ?? DEFAULT_CONFIG.worktree.dir,
			branchPrefix: asString(worktreeRoot.branchPrefix) ?? DEFAULT_CONFIG.worktree.branchPrefix,
			cleanup,
		},
		guardrailsDir: asString(root.guardrailsDir) ?? DEFAULT_CONFIG.guardrailsDir,
		idempotencyDir: asString(root.idempotencyDir) ?? DEFAULT_CONFIG.idempotencyDir,
		idempotencyTtlSec,
		checkpointsDir: asString(root.checkpointsDir) ?? DEFAULT_CONFIG.checkpointsDir,
		backends: {
			pi: sanitizeBackend("pi", backendRoot.pi, warnings),
			claude: sanitizeBackend("claude", backendRoot.claude, warnings),
			codex: sanitizeBackend("codex", backendRoot.codex, warnings),
		},
	};

	return {
		config,
		path: configPath,
		warnings,
	};
}

export function resolveProjectRoot(cwd: string, configPath: string | null): string {
	if (configPath) {
		return path.dirname(path.dirname(configPath));
	}
	const gitPath = findUp(cwd, ".git");
	if (!gitPath) return cwd;
	return path.dirname(gitPath);
}
