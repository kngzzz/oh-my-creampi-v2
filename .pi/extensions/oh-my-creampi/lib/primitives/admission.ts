import { createId } from "../util";

export type AdmissionGrant = {
	grantId: string;
	taskId: string;
	grantedAt: number;
};

export type AdmissionDecision =
	| { allowed: true; grant: AdmissionGrant }
	| { allowed: false; reason: string };

export type AdmissionSnapshot = {
	maxConcurrency: number;
	running: number;
	activeTaskIds: string[];
};

export class AdmissionController {
	private maxConcurrency: number;
	private readonly runningByTask = new Map<string, AdmissionGrant>();
	private readonly taskByGrant = new Map<string, string>();

	constructor(maxConcurrency: number) {
		this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
	}

	setMaxConcurrency(maxConcurrency: number): void {
		this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
	}

	admit(taskId: string): AdmissionDecision {
		const normalizedTaskId = taskId.trim();
		if (!normalizedTaskId) {
			return { allowed: false, reason: "taskId is required" };
		}

		const existing = this.runningByTask.get(normalizedTaskId);
		if (existing) {
			return {
				allowed: true,
				grant: existing,
			};
		}

		if (this.runningByTask.size >= this.maxConcurrency) {
			return {
				allowed: false,
				reason: `over capacity (${this.runningByTask.size}/${this.maxConcurrency})`,
			};
		}

		const grant: AdmissionGrant = {
			grantId: createId("grant"),
			taskId: normalizedTaskId,
			grantedAt: Date.now(),
		};
		this.runningByTask.set(normalizedTaskId, grant);
		this.taskByGrant.set(grant.grantId, normalizedTaskId);
		return { allowed: true, grant };
	}

	release(grantOrTaskId: string): void {
		const normalized = grantOrTaskId.trim();
		if (!normalized) return;

		const taskIdFromGrant = this.taskByGrant.get(normalized);
		if (taskIdFromGrant) {
			this.taskByGrant.delete(normalized);
			this.runningByTask.delete(taskIdFromGrant);
			return;
		}

		const existing = this.runningByTask.get(normalized);
		if (!existing) return;
		this.runningByTask.delete(normalized);
		this.taskByGrant.delete(existing.grantId);
	}

	snapshot(): AdmissionSnapshot {
		return {
			maxConcurrency: this.maxConcurrency,
			running: this.runningByTask.size,
			activeTaskIds: [...this.runningByTask.keys()].sort(),
		};
	}
}
