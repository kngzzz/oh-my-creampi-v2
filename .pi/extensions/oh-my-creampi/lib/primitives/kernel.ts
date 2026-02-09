import { computeFreshnessHash } from "./freshness";
import type {
	CompleteHandoffInput,
	Handoff,
	KernelSnapshot,
	Lease,
	RegisterWorkItemInput,
	TraceEvent,
	TransitionOptions,
	WorkItem,
	WorkItemState,
} from "./types";
import { createId } from "../util";

const DEFAULT_LEASE_TTL_MS = 60_000;
const DEFAULT_MAX_TRACE = 2_000;

const ALLOWED_TRANSITIONS: Record<WorkItemState, WorkItemState[]> = {
	pending: ["leased", "cancelled", "failed"],
	leased: ["pending", "running", "cancelled", "failed"],
	running: ["completed", "failed", "cancelled"],
	completed: [],
	failed: [],
	cancelled: [],
};

function now(): number {
	return Date.now();
}

function emptyStates(): Record<WorkItemState, number> {
	return {
		pending: 0,
		leased: 0,
		running: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
	};
}

export class HarnessKernel {
	private readonly workItems = new Map<string, WorkItem>();
	private readonly leases = new Map<string, Lease>();
	private readonly handoffs = new Map<string, Handoff>();
	private readonly trace: TraceEvent[] = [];
	private readonly defaultLeaseTtlMs: number;
	private readonly maxTrace: number;

	constructor(options?: { defaultLeaseTtlMs?: number; maxTrace?: number }) {
		this.defaultLeaseTtlMs = Math.max(1_000, Math.floor(options?.defaultLeaseTtlMs ?? DEFAULT_LEASE_TTL_MS));
		this.maxTrace = Math.max(100, Math.floor(options?.maxTrace ?? DEFAULT_MAX_TRACE));
	}

	registerWorkItem(input: RegisterWorkItemInput): WorkItem {
		const existing = this.workItems.get(input.id);
		if (existing) return existing;

		const createdAt = now();
		const item: WorkItem = {
			id: input.id,
			runId: input.runId ?? createId("run"),
			title: input.title,
			goal: input.goal,
			ownerAgent: input.ownerAgent,
			state: "pending",
			createdAt,
			updatedAt: createdAt,
			inputs: input.inputs ?? {},
		};
		this.workItems.set(item.id, item);
		this.pushTrace({
			workItemId: item.id,
			runId: item.runId,
			type: "workitem.created",
			agent: item.ownerAgent,
			data: {
				title: item.title,
			},
		});
		return item;
	}

	getWorkItem(workItemId: string): WorkItem | undefined {
		return this.workItems.get(workItemId);
	}

	listWorkItems(): WorkItem[] {
		return [...this.workItems.values()].sort((a, b) => b.createdAt - a.createdAt);
	}

	acquireLease(workItemId: string, holder: string, ttlMs = this.defaultLeaseTtlMs): { ok: boolean; lease?: Lease; error?: string } {
		const item = this.workItems.get(workItemId);
		if (!item) return { ok: false, error: `unknown work item: ${workItemId}` };

		const normalizedHolder = holder.trim();
		if (!normalizedHolder) return { ok: false, error: "holder is required" };

		const active = this.getLease(workItemId);
		if (active && active.holder !== normalizedHolder) {
			return { ok: false, error: `lease held by ${active.holder}` };
		}

		const timestamp = now();
		const lease: Lease = {
			workItemId,
			holder: normalizedHolder,
			acquiredAt: active?.acquiredAt ?? timestamp,
			heartbeatAt: timestamp,
			expiresAt: timestamp + Math.max(1_000, Math.floor(ttlMs)),
			ttlMs: Math.max(1_000, Math.floor(ttlMs)),
		};
		this.leases.set(workItemId, lease);

		if (item.state === "pending") {
			this.transitionWorkItem(workItemId, "leased", { agent: normalizedHolder, reason: "lease acquired" });
		}

		this.pushTrace({
			workItemId,
			runId: item.runId,
			type: "lease.acquired",
			agent: normalizedHolder,
			data: { ttlMs: lease.ttlMs },
		});
		return { ok: true, lease };
	}

	heartbeatLease(workItemId: string, holder: string): { ok: boolean; lease?: Lease; error?: string } {
		const item = this.workItems.get(workItemId);
		if (!item) return { ok: false, error: `unknown work item: ${workItemId}` };
		const lease = this.getLease(workItemId);
		if (!lease) return { ok: false, error: "no active lease" };
		if (lease.holder !== holder) return { ok: false, error: `lease held by ${lease.holder}` };

		const timestamp = now();
		const nextLease: Lease = {
			...lease,
			heartbeatAt: timestamp,
			expiresAt: timestamp + lease.ttlMs,
		};
		this.leases.set(workItemId, nextLease);
		this.pushTrace({
			workItemId,
			runId: item.runId,
			type: "lease.heartbeat",
			agent: holder,
		});
		return { ok: true, lease: nextLease };
	}

	releaseLease(workItemId: string, holder: string, reason = "released"): { ok: boolean; error?: string } {
		const item = this.workItems.get(workItemId);
		if (!item) return { ok: false, error: `unknown work item: ${workItemId}` };

		const lease = this.leases.get(workItemId);
		if (!lease) return { ok: true };
		if (lease.holder !== holder) {
			return { ok: false, error: `lease held by ${lease.holder}` };
		}

		this.leases.delete(workItemId);
		this.pushTrace({
			workItemId,
			runId: item.runId,
			type: "lease.released",
			agent: holder,
			data: { reason },
		});
		return { ok: true };
	}

	getLease(workItemId: string): Lease | undefined {
		const lease = this.leases.get(workItemId);
		if (!lease) return undefined;
		if (lease.expiresAt <= now()) {
			this.leases.delete(workItemId);
			return undefined;
		}
		return lease;
	}

	transitionWorkItem(
		workItemId: string,
		nextState: WorkItemState,
		options?: TransitionOptions,
	): { ok: boolean; item?: WorkItem; error?: string } {
		const item = this.workItems.get(workItemId);
		if (!item) return { ok: false, error: `unknown work item: ${workItemId}` };
		if (item.state === nextState) return { ok: true, item };

		const allowed = ALLOWED_TRANSITIONS[item.state] ?? [];
		if (!allowed.includes(nextState)) {
			return { ok: false, error: `invalid transition ${item.state} -> ${nextState}` };
		}

		const previous = item.state;
		item.state = nextState;
		item.updatedAt = now();
		if (options?.agent) item.ownerAgent = options.agent;

		if (nextState === "completed" || nextState === "failed" || nextState === "cancelled") {
			this.leases.delete(workItemId);
		}

		this.pushTrace({
			workItemId,
			runId: item.runId,
			type: "workitem.transition",
			agent: options?.agent,
			data: {
				from: previous,
				to: nextState,
				reason: options?.reason,
				...(options?.data ?? {}),
			},
		});
		return { ok: true, item };
	}

	completeWithHandoff(
		workItemId: string,
		input: CompleteHandoffInput,
	): { ok: boolean; handoff?: Handoff; state?: WorkItemState; error?: string } {
		const item = this.workItems.get(workItemId);
		if (!item) return { ok: false, error: `unknown work item: ${workItemId}` };

		const evals: Handoff["evals"] = input.evals ?? [];
		const blockingFailures = evals.filter((evalItem) => (evalItem.blocking ?? true) && !evalItem.passed);
		const nextState: WorkItemState = blockingFailures.length > 0 ? "failed" : "completed";

		const transition = this.transitionWorkItem(workItemId, nextState, {
			agent: input.fromAgent,
			reason: nextState === "completed" ? "handoff complete" : "blocking eval failed",
			data: {
				blockingFailures: blockingFailures.length,
			},
		});
		if (!transition.ok) return { ok: false, error: transition.error ?? "transition failed" };

		this.releaseLease(workItemId, input.fromAgent, nextState);

		const handoff: Handoff = {
			workItemId,
			runId: item.runId,
			fromAgent: input.fromAgent,
			toAgent: input.toAgent,
			summary: input.summary,
			nextAction: input.nextAction,
			evals,
			freshnessHash: computeFreshnessHash({
				summary: input.summary,
				nextAction: input.nextAction,
				evals,
			}),
			createdAt: now(),
		};
		this.handoffs.set(workItemId, handoff);

		this.pushTrace({
			workItemId,
			runId: item.runId,
			type: "handoff.created",
			agent: input.fromAgent,
			data: { freshnessHash: handoff.freshnessHash },
		});

		return { ok: nextState === "completed", handoff, state: nextState };
	}

	cancelWorkItem(workItemId: string, agent: string, reason = "cancelled"): { ok: boolean; error?: string } {
		const transition = this.transitionWorkItem(workItemId, "cancelled", { agent, reason });
		if (!transition.ok) return { ok: false, error: transition.error ?? "transition failed" };
		this.releaseLease(workItemId, agent, reason);
		return { ok: true };
	}

	failWorkItem(workItemId: string, agent: string, reason: string): { ok: boolean; error?: string } {
		const transition = this.transitionWorkItem(workItemId, "failed", { agent, reason });
		if (!transition.ok) return { ok: false, error: transition.error ?? "transition failed" };
		this.releaseLease(workItemId, agent, reason);
		return { ok: true };
	}

	recordPolicyDenied(input: {
		workItemId: string;
		runId: string;
		agent: string;
		violations: string[];
		reason?: string;
	}): void {
		this.pushTrace({
			workItemId: input.workItemId,
			runId: input.runId,
			type: "policy.denied",
			agent: input.agent,
			data: {
				violations: input.violations,
				reason: input.reason ?? "policy denied request",
			},
		});
	}

	getHandoff(workItemId: string): Handoff | undefined {
		return this.handoffs.get(workItemId);
	}

	getRecentTrace(options?: { workItemId?: string; limit?: number }): TraceEvent[] {
		const limit = Math.max(1, Math.floor(options?.limit ?? 20));
		const source = options?.workItemId
			? this.trace.filter((event) => event.workItemId === options.workItemId)
			: this.trace;
		return source.slice(-limit);
	}

	getSnapshot(): KernelSnapshot {
		const states = emptyStates();
		for (const item of this.workItems.values()) {
			states[item.state] = (states[item.state] ?? 0) + 1;
		}
		return {
			workItems: this.workItems.size,
			activeLeases: [...this.leases.values()].filter((lease) => lease.expiresAt > now()).length,
			handoffs: this.handoffs.size,
			traceEvents: this.trace.length,
			states,
		};
	}

	reset(): void {
		this.workItems.clear();
		this.leases.clear();
		this.handoffs.clear();
		this.trace.length = 0;
	}

	private pushTrace(event: Omit<TraceEvent, "id" | "timestamp">): void {
		this.trace.push({
			...event,
			id: createId("evt"),
			timestamp: now(),
		});
		if (this.trace.length > this.maxTrace) {
			this.trace.splice(0, this.trace.length - this.maxTrace);
		}
	}
}
