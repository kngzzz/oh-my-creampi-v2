import * as path from "node:path";

import { Type } from "@sinclair/typebox";

import { AgentRegistry, getBuiltinAgentProfiles, mergeAgentProfiles } from "./lib/agents";
import { discoverProjectAgentProfiles } from "./lib/agent-loader";
import { BackgroundTaskManager } from "./lib/background";
import { DEFAULT_CONFIG, loadCreamPiConfig, resolveProjectRoot } from "./lib/config";
import { discoverProjectLoopDefinitions } from "./lib/loops/loader";
import { LoopRuntime } from "./lib/loops/runtime";
import type { ExtensionAPI, ToolExecuteContext, ToolResult } from "./lib/types";

type RuntimeState = {
	root: string;
	configPath: string | null;
	configWarnings: string[];
	loopWarnings: string[];
	agents: AgentRegistry;
	background: BackgroundTaskManager;
	loopRuntime: LoopRuntime;
};

const BackgroundTaskParams = Type.Object({
	description: Type.String({ description: "Short task description" }),
	prompt: Type.String({ description: "Full prompt for the background agent" }),
	agent: Type.Optional(Type.String({ description: "Agent profile name" })),
	timeoutSec: Type.Optional(Type.Number({ description: "Task timeout in seconds" })),
});

const BackgroundStatusParams = Type.Object({
	taskId: Type.String({ description: "Background task ID" }),
});

const BackgroundCancelParams = Type.Object({
	taskId: Type.String({ description: "Background task ID" }),
});

const LoopTriggerParams = Type.Object({
	loopName: Type.String({ description: "Loop definition name" }),
	triggerSource: Type.Optional(Type.String({ description: "Trigger source label" })),
});

const LoopStatusParams = Type.Object({
	loopName: Type.Optional(Type.String({ description: "Loop definition name" })),
});

const GuardrailAddParams = Type.Object({
	domain: Type.String({ description: "Guardrail domain" }),
	lesson: Type.String({ description: "Lesson text to store" }),
	severity: Type.Optional(
		Type.Union([Type.Literal("info"), Type.Literal("warning"), Type.Literal("critical")], {
			description: "Lesson severity",
		}),
	),
});

function textResult(text: string, details?: Record<string, unknown>, isError = false): ToolResult {
	return {
		content: [{ type: "text", text }],
		details,
		isError,
	};
}

function resolveStoragePath(root: string, value: string): string {
	return path.isAbsolute(value) ? value : path.join(root, value);
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

async function checkCli(
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

export default function ohMyCreamPi(pi: ExtensionAPI): void {
	let runtime: RuntimeState | undefined;

	const ensureRuntime = (cwd: string): RuntimeState => {
		const loaded = loadCreamPiConfig(cwd);
		const root = resolveProjectRoot(cwd, loaded.path);
		if (runtime && runtime.root === root) {
			return runtime;
		}

		const discoveredAgents = discoverProjectAgentProfiles(cwd);
		const discoveredLoops = discoverProjectLoopDefinitions(cwd);

		const mergedAgents = mergeAgentProfiles(getBuiltinAgentProfiles(), discoveredAgents.agents);
		const agents = new AgentRegistry(mergedAgents);

		const config = loaded.config ?? DEFAULT_CONFIG;
		const background = new BackgroundTaskManager({
			agents,
			maxConcurrency: config.maxConcurrency,
			defaultTimeoutSec: config.defaultTimeoutSec,
			guardrailsDir: resolveStoragePath(root, config.guardrailsDir),
			idempotencyDir: resolveStoragePath(root, config.idempotencyDir),
			idempotencyTtlSec: config.idempotencyTtlSec,
		});

		const loopRuntime = new LoopRuntime({
			loops: discoveredLoops.loops,
			checkpointsDir: resolveStoragePath(root, config.checkpointsDir),
			idempotencyLedger: background.getIdempotencyLedger(),
			guardrails: background.getGuardrails(),
			launch: async (launchInput) => {
				const launched = await background.launch({
					description: launchInput.description,
					prompt: launchInput.prompt,
					agent: launchInput.agent,
					cwd: launchInput.cwd,
					timeoutSec: launchInput.timeoutSec,
					source: "loop_trigger",
					domain: launchInput.domain,
				});
				return {
					taskId: launched.task?.id,
					error: launched.error,
				};
			},
			idempotencyTtlSec: config.idempotencyTtlSec,
		});

		runtime = {
			root,
			configPath: loaded.path,
			configWarnings: [...loaded.warnings, ...discoveredAgents.warnings],
			loopWarnings: discoveredLoops.warnings,
			agents,
			background,
			loopRuntime,
		};
		return runtime;
	};

	pi.registerTool({
		name: "background_task",
		label: "Background Task",
		description: "Launch a one-off background agent task.",
		parameters: BackgroundTaskParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rt = ensureRuntime(ctx.cwd);
			const description = asString((params as Record<string, unknown>).description);
			const prompt = asString((params as Record<string, unknown>).prompt);
			if (!description || !prompt) {
				return textResult("description and prompt are required", undefined, true);
			}

			const launched = await rt.background.launch({
				description,
				prompt,
				agent: asString((params as Record<string, unknown>).agent) ?? DEFAULT_CONFIG.defaultAgent,
				cwd: ctx.cwd,
				timeoutSec: asNumber((params as Record<string, unknown>).timeoutSec),
				source: "background_task",
			});

			if (!launched.task) {
				return textResult(`[ERROR] ${launched.error ?? "failed to launch task"}`, { error: launched.error }, true);
			}

			return textResult(
				[
					"Background task queued.",
					`ID: ${launched.task.id}`,
					`Agent: @${launched.task.agent}`,
					`Status: ${launched.task.status}`,
				].join("\n"),
				{
					taskId: launched.task.id,
					status: launched.task.status,
					agent: launched.task.agent,
				},
			);
		},
	});

	pi.registerTool({
		name: "background_status",
		label: "Background Status",
		description: "Get status and output of a background task.",
		parameters: BackgroundStatusParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rt = ensureRuntime(ctx.cwd);
			const taskId = asString((params as Record<string, unknown>).taskId);
			if (!taskId) return textResult("taskId is required", undefined, true);

			const task = rt.background.getTask(taskId);
			if (!task) return textResult(`task not found: ${taskId}`, { error: "not_found" }, true);

			return textResult(
				[
					`ID: ${task.id}`,
					`Status: ${task.status}`,
					`Agent: @${task.agent}`,
					task.output ? `\n${task.output}` : "\n(no output yet)",
				].join("\n"),
				{
					id: task.id,
					status: task.status,
					agent: task.agent,
					output: task.output,
					usage: task.usage,
					error: task.error,
					duration: task.durationMs,
				},
			);
		},
	});

	pi.registerTool({
		name: "background_cancel",
		label: "Background Cancel",
		description: "Cancel a queued or running background task.",
		parameters: BackgroundCancelParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rt = ensureRuntime(ctx.cwd);
			const taskId = asString((params as Record<string, unknown>).taskId);
			if (!taskId) return textResult("taskId is required", undefined, true);
			const cancelled = rt.background.cancel(taskId);
			if (!cancelled) return textResult(`unable to cancel: ${taskId}`, { cancelled: false }, true);
			return textResult(`cancelled: ${taskId}`, { taskId, cancelled: true });
		},
	});

	pi.registerTool({
		name: "loop_trigger",
		label: "Loop Trigger",
		description: "Trigger a named loop runtime.",
		parameters: LoopTriggerParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rt = ensureRuntime(ctx.cwd);
			const loopName = asString((params as Record<string, unknown>).loopName);
			if (!loopName) return textResult("loopName is required", undefined, true);
			const result = await rt.loopRuntime.triggerLoop({
				loopName,
				cwd: ctx.cwd,
				triggerSource: asString((params as Record<string, unknown>).triggerSource),
			});
			const phaseLines = result.phases.map((phase) => `- ${phase.name}: ${phase.status}${phase.detail ? ` (${phase.detail})` : ""}`);
			return textResult(
				[
					`Loop: ${result.loopName}`,
					`Status: ${result.status}`,
					result.reason ? `Reason: ${result.reason}` : "",
					result.backgroundTaskId ? `Background task: ${result.backgroundTaskId}` : "",
					phaseLines.length ? "\nPhases:" : "",
					...phaseLines,
				].filter(Boolean).join("\n"),
				result as unknown as Record<string, unknown>,
				result.status === "error",
			);
		},
	});

	pi.registerTool({
		name: "loop_status",
		label: "Loop Status",
		description: "Show current loop state and checkpoint summary.",
		parameters: LoopStatusParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rt = ensureRuntime(ctx.cwd);
			const loopName = asString((params as Record<string, unknown>).loopName);
			const statuses = await rt.loopRuntime.getStatus(loopName);
			if (statuses.length === 0) {
				return textResult("no loops discovered", { loops: [] });
			}
			const lines = statuses.map(
				(status) =>
					`- ${status.name}: ${status.status}` +
					(status.lastRun ? ` · lastRun=${status.lastRun}` : "") +
					(status.nextScheduled ? ` · next=${status.nextScheduled}` : ""),
			);
			return textResult(["Loops", ...lines].join("\n"), {
				loops: statuses,
			});
		},
	});

	pi.registerTool({
		name: "guardrail_add",
		label: "Guardrail Add",
		description: "Add a guardrail lesson for a domain.",
		parameters: GuardrailAddParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rt = ensureRuntime(ctx.cwd);
			const domain = asString((params as Record<string, unknown>).domain);
			const lesson = asString((params as Record<string, unknown>).lesson);
			if (!domain || !lesson) {
				return textResult("domain and lesson are required", undefined, true);
			}
			const severityRaw = asString((params as Record<string, unknown>).severity) ?? "info";
			const severity = severityRaw === "critical" || severityRaw === "warning" ? severityRaw : "info";
			const entry = await rt.background.getGuardrails().append(domain, lesson, severity);
			return textResult(`guardrail added: [${entry.severity}] ${entry.lesson}`, {
				domain: entry.domain,
				severity: entry.severity,
				createdAt: entry.createdAt,
			});
		},
	});

	pi.registerCommand("creampi", {
		description: "Show CreamPi dashboard status.",
		handler: async (_args, ctx) => {
			const rt = ensureRuntime(ctx.cwd);
			const loops = await rt.loopRuntime.getStatus();
			const guardrailCounts = await rt.background.getGuardrails().countByDomain();
			const snapshot = rt.background.snapshot();
			const text = [
				"oh-my-creampi v2",
				`Root: ${rt.root}`,
				rt.configPath ? `Config: ${rt.configPath}` : "Config: default",
				`Background: queued=${snapshot.queued}, running=${snapshot.running}, concurrency=${snapshot.maxConcurrency}`,
				`Loops: ${loops.length}`,
				`Guardrail domains: ${Object.keys(guardrailCounts).length}`,
				rt.configWarnings.length ? `Warnings: ${rt.configWarnings.join(" | ")}` : "Warnings: none",
				rt.loopWarnings.length ? `Loop warnings: ${rt.loopWarnings.join(" | ")}` : "Loop warnings: none",
			].join("\n");
			if (ctx.hasUI && ctx.ui) {
				ctx.ui.notify(text, "info");
			} else {
				console.log(text);
			}
		},
	});

	pi.registerCommand("creampi-loops", {
		description: "List loops with trigger history and next schedule.",
		handler: async (_args, ctx) => {
			const rt = ensureRuntime(ctx.cwd);
			const loops = await rt.loopRuntime.getStatus();
			const text = loops.length
				? ["CreamPi loops", ...loops.map((loop) => `- ${loop.name}: ${loop.status}${loop.nextScheduled ? ` (next ${loop.nextScheduled})` : ""}`)].join("\n")
				: "No loops discovered.";
			if (ctx.hasUI && ctx.ui) ctx.ui.notify(text, "info");
			else console.log(text);
		},
	});

	pi.registerCommand("creampi-health", {
		description: "Check backend CLI availability for pi/claude/codex.",
		handler: async (_args, ctx) => {
			const piHealth = await checkCli(pi, ctx, "pi", ["--version"]);
			const claudeHealth = await checkCli(pi, ctx, "claude", ["--version"]);
			const codexHealth = await checkCli(pi, ctx, "codex", ["--version"]);
			const lines = [
				"CreamPi health",
				`- pi: ${piHealth.ready ? "ready" : "missing"} (${piHealth.detail})`,
				`- claude: ${claudeHealth.ready ? "ready" : "missing"} (${claudeHealth.detail})`,
				`- codex: ${codexHealth.ready ? "ready" : "missing"} (${codexHealth.detail})`,
			];
			const text = lines.join("\n");
			if (ctx.hasUI && ctx.ui) ctx.ui.notify(text, "info");
			else console.log(text);
		},
	});

	if (pi.on) {
		pi.on("session_start", (_event, ctx) => {
			ensureRuntime(ctx.cwd);
		});
		pi.on("session_switch", (_event, ctx) => {
			ensureRuntime(ctx.cwd);
		});
	}
}
