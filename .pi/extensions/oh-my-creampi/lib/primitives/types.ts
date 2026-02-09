export type WorkItemState = "pending" | "leased" | "running" | "completed" | "failed" | "cancelled";

export type WorkItem = {
	id: string;
	runId: string;
	title: string;
	goal: string;
	ownerAgent?: string;
	state: WorkItemState;
	createdAt: number;
	updatedAt: number;
	inputs: Record<string, unknown>;
};

export type Lease = {
	workItemId: string;
	holder: string;
	acquiredAt: number;
	heartbeatAt: number;
	expiresAt: number;
	ttlMs: number;
};

export type EvalResult = {
	name: string;
	passed: boolean;
	blocking?: boolean;
	details?: string;
};

export type Handoff = {
	workItemId: string;
	runId: string;
	fromAgent: string;
	toAgent?: string;
	summary: string;
	nextAction: string;
	evals: EvalResult[];
	freshnessHash: string;
	createdAt: number;
};

export type TraceEventType =
	| "workitem.created"
	| "workitem.transition"
	| "lease.acquired"
	| "lease.heartbeat"
	| "lease.released"
	| "handoff.created"
	| "policy.denied";

export type TraceEvent = {
	id: string;
	workItemId: string;
	runId: string;
	type: TraceEventType;
	timestamp: number;
	agent?: string;
	data?: Record<string, unknown>;
};

export type RegisterWorkItemInput = {
	id: string;
	runId?: string;
	title: string;
	goal: string;
	ownerAgent?: string;
	inputs?: Record<string, unknown>;
};

export type TransitionOptions = {
	agent?: string;
	reason?: string;
	data?: Record<string, unknown>;
};

export type CompleteHandoffInput = {
	fromAgent: string;
	toAgent?: string;
	summary: string;
	nextAction: string;
	evals?: EvalResult[];
};

export type KernelSnapshot = {
	workItems: number;
	activeLeases: number;
	handoffs: number;
	traceEvents: number;
	states: Record<WorkItemState, number>;
};
