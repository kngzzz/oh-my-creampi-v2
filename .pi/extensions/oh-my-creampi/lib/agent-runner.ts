import { spawn } from "node:child_process";

import type { AgentBackend, AgentRunHandle, AgentRunRequest, AgentRunResult, Usage } from "./types";

type SpawnFunction = typeof spawn;

type RunnerDependencies = {
	spawnImpl?: SpawnFunction;
	commandMap?: Partial<Record<AgentBackend, string>>;
};

function emptyUsage(): Usage {
	return {
		turns: 0,
		input: 0,
		output: 0,
		cost: 0,
	};
}

function commandForBackend(backend: AgentBackend, commandMap?: Partial<Record<AgentBackend, string>>): string {
	if (commandMap?.[backend]) return commandMap[backend] as string;
	if (backend === "claude") return "claude";
	if (backend === "codex") return "codex";
	return "pi";
}

function argsForRequest(request: AgentRunRequest): string[] {
	const backend = request.agent.backend;
	if (backend === "claude") {
		const args = ["-p", request.prompt, "--output-format", "json", "--no-session-persistence"];
		if (request.agent.model) args.push("--model", request.agent.model);
		return args;
	}
	if (backend === "codex") {
		const args = ["exec", request.prompt, "--json"];
		if (request.agent.model) args.push("--model", request.agent.model);
		return args;
	}

	const args = ["-p", request.prompt, "--agent", request.agent.name];
	if (request.agent.model) args.push("--model", request.agent.model);
	if (request.agent.provider) args.push("--provider", request.agent.provider);
	return args;
}

function maybeJson(text: string): unknown {
	const trimmed = text.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean).reverse();
		for (const line of lines) {
			try {
				return JSON.parse(line);
			} catch {
				continue;
			}
		}
		return undefined;
	}
}

function extractText(payload: unknown): string {
	if (typeof payload === "string") return payload;
	if (typeof payload === "number" || typeof payload === "boolean") return String(payload);
	if (Array.isArray(payload)) {
		const parts = payload.map((item) => extractText(item)).filter(Boolean);
		return parts.join("\n");
	}
	if (payload && typeof payload === "object") {
		const record = payload as Record<string, unknown>;
		return (
			extractText(record.result) ||
			extractText(record.message) ||
			extractText(record.output) ||
			extractText(record.content) ||
			""
		);
	}
	return "";
}

function extractUsage(payload: unknown): Usage {
	const usage = emptyUsage();
	if (!payload || typeof payload !== "object") return usage;
	const record = payload as Record<string, unknown>;
	const usageNode = (record.usage ?? record.metrics ?? {}) as Record<string, unknown>;
	const toNumber = (value: unknown): number =>
		typeof value === "number" && Number.isFinite(value) ? value : 0;
	usage.turns = toNumber(record.turns) || toNumber(record.num_turns);
	usage.input = toNumber(usageNode.input_tokens) || toNumber(usageNode.input);
	usage.output = toNumber(usageNode.output_tokens) || toNumber(usageNode.output);
	usage.cost = toNumber(record.total_cost_usd) || toNumber(usageNode.cost);
	return usage;
}

function parseResult(stdout: string): { output: string; usage: Usage } {
	const parsed = maybeJson(stdout);
	if (!parsed) {
		return { output: stdout.trim(), usage: emptyUsage() };
	}
	const output = extractText(parsed).trim() || stdout.trim();
	return {
		output,
		usage: extractUsage(parsed),
	};
}

function attachAbort(
	request: AgentRunRequest,
	kill: () => void,
): void {
	if (!request.signal) return;
	if (request.signal.aborted) {
		kill();
		return;
	}
	request.signal.addEventListener("abort", kill, { once: true });
}

export function spawnAgentRun(request: AgentRunRequest, deps?: RunnerDependencies): AgentRunHandle {
	const backend = request.agent.backend;
	const command = commandForBackend(backend, deps?.commandMap);
	const args = argsForRequest(request);
	const spawnImpl = deps?.spawnImpl ?? spawn;

	const proc = spawnImpl(command, args, {
		cwd: request.cwd,
		stdio: ["pipe", "pipe", "pipe"],
		shell: false,
		env: request.env,
	});

	let stdout = "";
	let stderr = "";
	let timedOut = false;
	let finished = false;
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

	proc.stdout.on("data", (chunk) => {
		stdout += chunk.toString();
	});
	proc.stderr.on("data", (chunk) => {
		stderr += chunk.toString();
	});

	const kill = () => {
		try {
			proc.kill("SIGTERM");
		} catch {
			// ignore
		}
		setTimeout(() => {
			if (finished) return;
			try {
				proc.kill("SIGKILL");
			} catch {
				// ignore
			}
		}, 3000).unref?.();
	};

	attachAbort(request, kill);

	if (request.timeoutSec && request.timeoutSec > 0) {
		timeoutHandle = setTimeout(() => {
			timedOut = true;
			kill();
		}, Math.floor(request.timeoutSec * 1000));
		timeoutHandle.unref?.();
	}

	const done = new Promise<AgentRunResult>((resolve) => {
		const finalize = (code: number | null): void => {
			if (finished) return;
			finished = true;
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
			const parsed = parseResult(stdout);
			resolve({
				exitCode: code ?? (timedOut ? 124 : 1),
				stdout,
				stderr,
				output: parsed.output,
				usage: parsed.usage,
				timedOut: timedOut || undefined,
			});
		};

		proc.on("error", (error) => {
			stderr += `${error instanceof Error ? error.message : String(error)}\n`;
			finalize(1);
		});
		proc.on("close", (code) => finalize(code));
	});

	return {
		proc,
		done,
	};
}
