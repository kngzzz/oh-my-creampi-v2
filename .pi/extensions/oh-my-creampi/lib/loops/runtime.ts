import * as fs from "node:fs";
import * as path from "node:path";

import { composeKernelPrompt, readKernelAwareness } from "../kernel-awareness";
import { ConditionEngine, IdempotencyLedger, type PolicyConfig, evaluatePolicy, type GuardrailMemory } from "../primitives";
import { createId, ensureDir, readTextIfExists, renderTemplate, sha256Hex } from "../util";
import { advanceLoopRuntimeState, initializeLoopRuntimeState, markLoopRuntimeTerminal } from "./runtime-state";
import type {
	LoopCheckpoint,
	LoopDefinition,
	LoopPhaseEvent,
	LoopStatusEntry,
	LoopTriggerRequest,
	LoopTriggerResult,
	LoopTriggerResultStatus,
	LoopTriggerType,
} from "./types";

type LaunchResult = {
	taskId?: string;
	error?: string;
};

type LoopRuntimeOptions = {
	loops?: LoopDefinition[];
	projectRoot: string;
	checkpointsDir: string;
	idempotencyLedger: IdempotencyLedger;
	guardrails: GuardrailMemory;
	launch: (input: {
		agent: string;
		description: string;
		prompt: string;
		promptComposed?: boolean;
		cwd: string;
		timeoutSec: number;
		domain?: string;
	}) => Promise<LaunchResult> | LaunchResult;
	policyConfig?: PolicyConfig;
	conditionEngine?: ConditionEngine;
	idempotencyTtlSec?: number;
	now?: () => number;
};

function normalizeLoopFileName(name: string): string {
	return name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
}

function coerceTriggerType(loop: LoopDefinition, requested: LoopTriggerType | undefined): LoopTriggerType {
	if (requested === "manual" || requested === "cron" || requested === "event") {
		return requested;
	}
	return loop.trigger.type;
}

function nextScheduledFor(loop: LoopDefinition, runAt: number): string | undefined {
	if (loop.trigger.type !== "cron") return undefined;
	if (loop.cooldownSec > 0) {
		return new Date(runAt + loop.cooldownSec * 1000).toISOString();
	}
	if (loop.trigger.schedule) {
		return `cron:${loop.trigger.schedule}`;
	}
	return undefined;
}

function makeIdempotencyKey(input: {
	loopName: string;
	triggerType: LoopTriggerType;
	triggerSource?: string;
	payload?: Record<string, unknown>;
}): string {
	const payloadHash = sha256Hex(input.payload ?? {});
	return [
		`loop:${input.loopName}`,
		`type:${input.triggerType}`,
		`source:${input.triggerSource ?? "manual"}`,
		`payload:${payloadHash}`,
	].join("|");
}

export class LoopRuntime {
	private readonly projectRoot: string;
	private readonly checkpointsDir: string;
	private readonly idempotency: IdempotencyLedger;
	private readonly guardrails: GuardrailMemory;
	private readonly launch: LoopRuntimeOptions["launch"];
	private readonly policyConfig?: PolicyConfig;
	private readonly conditions: ConditionEngine;
	private readonly idempotencyTtlSec: number;
	private readonly now: () => number;
	private readonly loops = new Map<string, LoopDefinition>();

	constructor(options: LoopRuntimeOptions) {
		this.projectRoot = options.projectRoot;
		this.checkpointsDir = options.checkpointsDir;
		this.idempotency = options.idempotencyLedger;
		this.guardrails = options.guardrails;
		this.launch = options.launch;
		this.policyConfig = options.policyConfig;
		this.conditions = options.conditionEngine ?? new ConditionEngine();
		this.idempotencyTtlSec = Math.max(1, Math.floor(options.idempotencyTtlSec ?? 600));
		this.now = options.now ?? (() => Date.now());
		this.setLoops(options.loops ?? []);
	}

	setLoops(loops: LoopDefinition[]): void {
		this.loops.clear();
		for (const loop of loops) {
			this.loops.set(loop.name, loop);
		}
	}

	private checkpointPath(loopName: string): string {
		return path.join(this.checkpointsDir, `${normalizeLoopFileName(loopName)}.json`);
	}

	private async readCheckpoint(loopName: string): Promise<LoopCheckpoint | undefined> {
		const filePath = this.checkpointPath(loopName);
		const raw = await readTextIfExists(filePath);
		if (!raw) return undefined;
		try {
			const parsed = JSON.parse(raw) as Partial<LoopCheckpoint>;
			if (typeof parsed.loopName !== "string") return undefined;
			return {
				loopName: parsed.loopName,
				updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(this.now()).toISOString(),
				lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : undefined,
				lastRunId: typeof parsed.lastRunId === "string" ? parsed.lastRunId : undefined,
				lastStatus:
					typeof parsed.lastStatus === "string"
						? (parsed.lastStatus as LoopCheckpoint["lastStatus"])
						: "idle",
				nextScheduled: typeof parsed.nextScheduled === "string" ? parsed.nextScheduled : undefined,
				lastResult: parsed.lastResult as LoopCheckpoint["lastResult"],
			};
		} catch {
			return undefined;
		}
	}

	private async writeCheckpoint(checkpoint: LoopCheckpoint): Promise<void> {
		await ensureDir(this.checkpointsDir);
		const filePath = this.checkpointPath(checkpoint.loopName);
		await fs.promises.writeFile(filePath, JSON.stringify(checkpoint, null, 2), "utf8");
	}

	private phase(
		events: LoopPhaseEvent[],
		name: LoopPhaseEvent["name"],
		status: LoopPhaseEvent["status"],
		detail?: string,
	): void {
		events.push({ name, status, detail });
	}

	private checkpointFromResult(loopName: string, result: LoopTriggerResult, runAt: number): LoopCheckpoint {
		return {
			loopName,
			updatedAt: new Date(this.now()).toISOString(),
			lastRunAt: new Date(runAt).toISOString(),
			lastRunId: result.runId,
			lastStatus: result.status,
			nextScheduled: result.nextScheduled,
			lastResult: result,
		};
	}

	async triggerLoop(request: LoopTriggerRequest): Promise<LoopTriggerResult> {
		const loop = this.loops.get(request.loopName);
		if (!loop) {
			return {
				loopName: request.loopName,
				status: "error",
				reason: `loop not found: ${request.loopName}`,
				phases: [],
			};
		}

		const runAt = this.now();
		const triggerType = coerceTriggerType(loop, request.triggerType);
		const triggerSource = request.triggerSource ?? "manual";
		const runId = createId("run");
		const phases: LoopPhaseEvent[] = [];
		let runtime = initializeLoopRuntimeState(loop.name, runId);

		this.phase(phases, "trigger", "ok", `${triggerType}:${triggerSource}`);

		const checkpoint = await this.readCheckpoint(loop.name);
		if (loop.cooldownSec > 0 && checkpoint?.lastRunAt) {
			const lastRunMs = Date.parse(checkpoint.lastRunAt);
			if (Number.isFinite(lastRunMs) && runAt - lastRunMs < loop.cooldownSec * 1000) {
				runtime = advanceLoopRuntimeState(runtime, "shouldRun");
				this.phase(phases, "shouldRun", "skipped", `cooldown active (${loop.cooldownSec}s)`);
				runtime = markLoopRuntimeTerminal(runtime, "skipped");
				const result: LoopTriggerResult = {
					loopName: loop.name,
					status: "skipped",
					reason: "cooldown active",
					runId,
					phases,
					nextScheduled: nextScheduledFor(loop, runAt),
				};
				await this.writeCheckpoint(this.checkpointFromResult(loop.name, result, runAt));
				return result;
			}
		}

		runtime = advanceLoopRuntimeState(runtime, "shouldRun");
		if (loop.shouldRun) {
			const shouldRun = this.conditions.evaluate(loop.shouldRun, {
				inputs: loop.inputs,
				payload: request.payload ?? {},
				state: {
					triggerType,
					triggerSource,
				},
			});
			if (!shouldRun.passed) {
				this.phase(phases, "shouldRun", "skipped", shouldRun.reason);
				runtime = markLoopRuntimeTerminal(runtime, "skipped");
				const result: LoopTriggerResult = {
					loopName: loop.name,
					status: "skipped",
					reason: shouldRun.reason,
					runId,
					phases,
					nextScheduled: nextScheduledFor(loop, runAt),
				};
				await this.writeCheckpoint(this.checkpointFromResult(loop.name, result, runAt));
				return result;
			}
			this.phase(phases, "shouldRun", "ok", "condition passed");
		} else {
			this.phase(phases, "shouldRun", "ok", "no condition configured");
		}

		runtime = advanceLoopRuntimeState(runtime, "context");
		const context = {
			...loop.inputs,
			payload: request.payload ?? {},
			trigger: {
				type: triggerType,
				source: triggerSource,
			},
		};
		const renderedPrompt = renderTemplate(loop.promptTemplate, context);
		const kernelAwareness = await readKernelAwareness(this.projectRoot);
		const guardrailBlock = await this.guardrails.renderForPrompt(loop.name, 5);
		const prompt = composeKernelPrompt({
			kernelAwareness,
			guardrails: guardrailBlock,
			prompt: renderedPrompt,
		});
		this.phase(phases, "context", "ok", `promptChars=${prompt.length}`);

		runtime = advanceLoopRuntimeState(runtime, "execute");
		const policy = evaluatePolicy(this.policyConfig, {
			kind: "loop_trigger",
			agent: loop.agent,
			prompt,
			triggerSource,
		});
		if (!policy.allowed) {
			this.phase(phases, "execute", "error", policy.violations.join("; "));
			runtime = markLoopRuntimeTerminal(runtime, "error");
			const result: LoopTriggerResult = {
				loopName: loop.name,
				status: "error",
				reason: policy.reason ?? "policy denied",
				runId,
				phases,
				nextScheduled: nextScheduledFor(loop, runAt),
			};
			await this.writeCheckpoint(this.checkpointFromResult(loop.name, result, runAt));
			return result;
		}

		const idempotencyKey = makeIdempotencyKey({
			loopName: loop.name,
			triggerType,
			triggerSource,
			payload: request.payload,
		});
		const idempotency = await this.idempotency.checkAndRecord(idempotencyKey, this.idempotencyTtlSec);
		if (idempotency.duplicate) {
			this.phase(phases, "execute", "skipped", "duplicate trigger");
			runtime = markLoopRuntimeTerminal(runtime, "duplicate");
			const result: LoopTriggerResult = {
				loopName: loop.name,
				status: "duplicate",
				reason: "duplicate trigger",
				runId,
				phases,
				nextScheduled: nextScheduledFor(loop, runAt),
			};
			await this.writeCheckpoint(this.checkpointFromResult(loop.name, result, runAt));
			return result;
		}

		let backgroundTaskId: string | undefined;
		if (request.dryRun) {
			this.phase(phases, "execute", "ok", "dry-run prepared");
		} else {
			const launched = await this.launch({
				agent: loop.agent,
				description: `loop:${loop.name}`,
				prompt,
				promptComposed: true,
				cwd: request.cwd,
				timeoutSec: loop.timeoutSec,
				domain: loop.name,
			});
			if (!launched.taskId) {
				this.phase(phases, "execute", "error", launched.error ?? "launch failed");
				runtime = markLoopRuntimeTerminal(runtime, "error");
				const result: LoopTriggerResult = {
					loopName: loop.name,
					status: "error",
					reason: launched.error ?? "launch failed",
					runId,
					phases,
					nextScheduled: nextScheduledFor(loop, runAt),
				};
				await this.writeCheckpoint(this.checkpointFromResult(loop.name, result, runAt));
				return result;
			}
			backgroundTaskId = launched.taskId;
			this.phase(phases, "execute", "ok", `background task ${backgroundTaskId}`);
		}

		runtime = advanceLoopRuntimeState(runtime, "evaluate");
		this.phase(phases, "evaluate", "deferred", "evaluation occurs after task completion");

		runtime = advanceLoopRuntimeState(runtime, "learn");
		this.phase(phases, "learn", "deferred", "learning occurs after evaluation");

		runtime = advanceLoopRuntimeState(runtime, "handoff");
		const handoffHash = sha256Hex({
			loop: loop.name,
			runId,
			backgroundTaskId,
			prompt,
		});
		this.phase(phases, "handoff", "ok", `freshness=${handoffHash.slice(0, 12)}`);

		runtime = advanceLoopRuntimeState(runtime, "retrigger");
		const nextScheduled = nextScheduledFor(loop, runAt);
		this.phase(phases, "retrigger", "deferred", nextScheduled ? `next ${nextScheduled}` : "manual trigger");

		const status: LoopTriggerResultStatus = request.dryRun ? "prepared" : "launched";
		runtime = markLoopRuntimeTerminal(runtime, status);

		const result: LoopTriggerResult = {
			loopName: loop.name,
			status,
			runId,
			backgroundTaskId,
			phases,
			nextScheduled,
		};
		await this.writeCheckpoint(this.checkpointFromResult(loop.name, result, runAt));
		return result;
	}

	async getStatus(loopName?: string): Promise<LoopStatusEntry[]> {
		const targets = loopName ? [loopName] : [...this.loops.keys()];
		const statuses: LoopStatusEntry[] = [];
		for (const name of targets.sort((a, b) => a.localeCompare(b))) {
			const checkpoint = await this.readCheckpoint(name);
			statuses.push({
				name,
				lastRun: checkpoint?.lastRunAt,
				status: checkpoint?.lastStatus ?? "idle",
				nextScheduled: checkpoint?.nextScheduled,
			});
		}
		return statuses;
	}
}
