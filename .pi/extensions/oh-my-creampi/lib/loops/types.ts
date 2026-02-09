import type { AgentBackend } from "../types";

export const LOOP_PHASE_ORDER = [
	"trigger",
	"shouldRun",
	"context",
	"execute",
	"evaluate",
	"learn",
	"handoff",
	"retrigger",
] as const;

export type LoopPhaseName = (typeof LOOP_PHASE_ORDER)[number];

export type LoopPhaseStatus = "ok" | "skipped" | "deferred" | "error";

export type LoopPhaseEvent = {
	name: LoopPhaseName;
	status: LoopPhaseStatus;
	detail?: string;
};

export type LoopTriggerType = "manual" | "cron" | "event";

export type LoopTriggerDefinition = {
	type: LoopTriggerType;
	schedule?: string;
	event?: string;
	source?: string;
};

export type LoopBudget = {
	maxTokens?: number;
	maxCostUsd?: number;
	maxDurationSec?: number;
};

export type LoopEval = {
	type: "exit_code";
	passCondition: number;
	blocking: boolean;
};

export type LoopDefinition = {
	name: string;
	version: number;
	description: string;
	trigger: LoopTriggerDefinition;
	agent: string;
	backend: AgentBackend;
	timeoutSec: number;
	maxConcurrent: number;
	cooldownSec: number;
	maxRetries: number;
	inputs: Record<string, unknown>;
	budget: LoopBudget;
	eval: LoopEval;
	shouldRun?: string;
	promptTemplate: string;
	filePath: string;
	updatedAt: number;
};

export type LoopDiscoveryResult = {
	loops: LoopDefinition[];
	loopsDir: string | null;
	warnings: string[];
};

export type LoopTriggerRequest = {
	loopName: string;
	cwd: string;
	triggerType?: LoopTriggerType;
	triggerSource?: string;
	payload?: Record<string, unknown>;
	dryRun?: boolean;
};

export type LoopTriggerResultStatus = "launched" | "prepared" | "skipped" | "duplicate" | "error";

export type LoopTriggerResult = {
	loopName: string;
	status: LoopTriggerResultStatus;
	reason?: string;
	runId?: string;
	backgroundTaskId?: string;
	phases: LoopPhaseEvent[];
	nextScheduled?: string;
};

export type LoopCheckpoint = {
	loopName: string;
	updatedAt: string;
	lastRunAt?: string;
	lastRunId?: string;
	lastStatus: LoopTriggerResultStatus | "idle";
	nextScheduled?: string;
	lastResult?: LoopTriggerResult;
};

export type LoopStatusEntry = {
	name: string;
	lastRun?: string;
	status: LoopTriggerResultStatus | "idle";
	nextScheduled?: string;
};
