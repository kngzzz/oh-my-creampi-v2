import { Type } from "@sinclair/typebox";

import { DEFAULT_CONFIG } from "../config";
import { asNumber, asString, textResult } from "../index-helpers";
import type { EnsureRuntime } from "../runtime-types";
import type { TemporalLoopEngine } from "../temporal-loop";
import type { ExtensionAPI } from "../types";

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

const SignalLoopSuccessParams = Type.Object({
	summary: Type.Optional(Type.String({ description: "Optional completion summary" })),
});

const SelfQueryParams = Type.Object({
	prompt: Type.String({ description: "Prompt for the child self-query" }),
	agent: Type.Optional(Type.String({ description: "Agent profile name for the child query" })),
	timeoutSec: Type.Optional(Type.Number({ description: "Timeout in seconds for child query" })),
	context: Type.Optional(Type.String({ description: "Optional context prepended to child prompt" })),
});

type RegisterToolsOptions = {
	ensureRuntime: EnsureRuntime;
	temporalLoop: TemporalLoopEngine;
};

export function registerTools(pi: ExtensionAPI, options: RegisterToolsOptions): void {
	const { ensureRuntime, temporalLoop } = options;

	pi.registerTool({
		name: "background_task",
		label: "Background Task",
		description: "Launch a one-off background agent task.",
		parameters: BackgroundTaskParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rt = ensureRuntime(ctx.cwd);
			const raw = params as Record<string, unknown>;
			const description = asString(raw.description);
			const prompt = asString(raw.prompt);
			if (!description || !prompt) {
				return textResult("description and prompt are required", undefined, true);
			}

			const launched = await rt.background.launch({
				description,
				prompt,
				agent: asString(raw.agent) ?? DEFAULT_CONFIG.defaultAgent,
				cwd: ctx.cwd,
				timeoutSec: asNumber(raw.timeoutSec),
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
		name: "self_query",
		label: "Self Query",
		description: "Run a child recursive query with depth guardrails.",
		parameters: SelfQueryParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rt = ensureRuntime(ctx.cwd);
			const raw = params as Record<string, unknown>;
			const prompt = asString(raw.prompt);
			if (!prompt) return textResult("prompt is required", undefined, true);

			const response = await rt.selfRecursion.query(
				{
					prompt,
					agent: asString(raw.agent),
					timeoutSec: asNumber(raw.timeoutSec),
					context: asString(raw.context),
				},
				{ cwd: ctx.cwd },
			);

			if (!response.result) {
				return textResult(response.error ?? "self query failed", { error: response.error }, true);
			}

			return textResult(
				[
					`Self query completed: ${response.result.taskId}`,
					`Depth: ${response.result.depth}`,
					`Exit: ${response.result.exitCode}`,
					"",
					response.result.output || "(no output)",
				].join("\n"),
				response.result as unknown as Record<string, unknown>,
				response.result.exitCode !== 0,
			);
		},
	});

	pi.registerTool({
		name: "signal_loop_success",
		label: "Signal Loop Success",
		description: "Signal that the active temporal loop condition has been met.",
		parameters: SignalLoopSuccessParams,
		async execute(_toolCallId, params) {
			const summary = asString((params as Record<string, unknown>).summary);
			return temporalLoop.signalSuccess(summary);
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
}
