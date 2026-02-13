import { AgentRegistry } from "./agents";
import { spawnAgentRun } from "./agent-runner";
import { composeKernelPrompt, readKernelAwareness } from "./kernel-awareness";
import type { AgentRunRequest, BackgroundLaunchInput, BackgroundTask, Usage } from "./types";
import type { WorktreeConfig } from "./types";
import { createWorktree, removeWorktree, type ExecFn } from "./worktree";
import {
	AdmissionController,
	GuardrailMemory,
	HarnessKernel,
	IdempotencyLedger,
	evaluatePolicy,
	type PolicyConfig,
} from "./primitives";
import { createId, sha256Hex } from "./util";

type SpawnRunner = (request: AgentRunRequest) => ReturnType<typeof spawnAgentRun>;

type BackgroundTaskManagerOptions = {
	agents: AgentRegistry;
	maxConcurrency: number;
	defaultTimeoutSec: number;
	policyConfig?: PolicyConfig;
	guardrailsDir: string;
	idempotencyDir: string;
	idempotencyTtlSec: number;
	spawnRunner?: SpawnRunner;
	admission?: AdmissionController;
	guardrails?: GuardrailMemory;
	idempotency?: IdempotencyLedger;
	kernel?: HarnessKernel;
	projectRoot?: string;
	worktreeConfig?: WorktreeConfig;
	exec?: ExecFn;
};

function emptyUsage(): Usage {
	return {
		turns: 0,
		input: 0,
		output: 0,
		cost: 0,
	};
}

export class BackgroundTaskManager {
	private readonly agents: AgentRegistry;
	private readonly spawnRunner: SpawnRunner;
	private readonly guardrails: GuardrailMemory;
	private readonly idempotency: IdempotencyLedger;
	private readonly kernel: HarnessKernel;
	private readonly admission: AdmissionController;
	private readonly defaultTimeoutSec: number;
	private policyConfig?: PolicyConfig;
	private readonly idempotencyTtlSec: number;
	private readonly projectRoot: string;
	private readonly worktreeConfig: WorktreeConfig;
	private readonly exec?: ExecFn;

	private maxConcurrency: number;
	private readonly tasks = new Map<string, BackgroundTask>();
	private readonly queue: string[] = [];
	private readonly running = new Set<string>();
	private pumping = false;

	constructor(options: BackgroundTaskManagerOptions) {
		this.agents = options.agents;
		this.maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency));
		this.defaultTimeoutSec = Math.max(0, Math.floor(options.defaultTimeoutSec));
		this.policyConfig = options.policyConfig;
		this.idempotencyTtlSec = Math.max(1, Math.floor(options.idempotencyTtlSec));
		this.spawnRunner = options.spawnRunner ?? spawnAgentRun;
		this.admission = options.admission ?? new AdmissionController(this.maxConcurrency);
		this.guardrails = options.guardrails ?? new GuardrailMemory(options.guardrailsDir);
		this.projectRoot = options.projectRoot ?? process.cwd();
		this.worktreeConfig =
			options.worktreeConfig ?? {
				enabled: false,
				dir: ".creampi/worktrees",
				branchPrefix: "creampi/",
				cleanup: "on-finish",
			};
		this.exec = options.exec;
		this.idempotency =
			options.idempotency ??
			new IdempotencyLedger({
				dir: options.idempotencyDir,
				ttlSec: this.idempotencyTtlSec,
			});
		this.kernel = options.kernel ?? new HarnessKernel();
	}

	setMaxConcurrency(maxConcurrency: number): void {
		this.maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
		this.admission.setMaxConcurrency(this.maxConcurrency);
		void this.processQueue();
	}

	setPolicyConfig(policyConfig: PolicyConfig | undefined): void {
		this.policyConfig = policyConfig;
	}

	async launch(input: BackgroundLaunchInput): Promise<{ task?: BackgroundTask; error?: string }> {
		const profile = this.agents.resolve(input.agent);
		if (!profile) {
			return { error: `unknown agent profile: ${input.agent}` };
		}

		const taskId = createId("task");
		const policy = evaluatePolicy(this.policyConfig, {
			kind: "background_task",
			agent: profile.name,
			prompt: input.prompt,
			requestedTools: profile.tools,
		});
		if (!policy.allowed) {
			return { error: policy.reason ?? policy.violations.join("; ") };
		}

		const admission = this.admission.admit(taskId);
		if (!admission.allowed) {
			return { error: admission.reason };
		}

		const idempotencyKey = sha256Hex({
			agent: profile.name,
			description: input.description,
			prompt: input.prompt,
			cwd: input.cwd,
		});
		const duplicate = await this.idempotency.checkAndRecord(idempotencyKey, this.idempotencyTtlSec);
		if (duplicate.duplicate) {
			this.admission.release(taskId);
			return { error: "duplicate task rejected by idempotency ledger" };
		}

		const kernelAwareness = await readKernelAwareness(this.projectRoot);
		const guardrailDomain = input.domain ?? profile.name;
		const guardrailPrefix = input.promptComposed ? "" : await this.guardrails.renderForPrompt(guardrailDomain, 8);
		const prompt = input.promptComposed
			? input.prompt
			: composeKernelPrompt({
					kernelAwareness,
					guardrails: guardrailPrefix ?? undefined,
					prompt: input.prompt,
				});

		const kernelItem = this.kernel.registerWorkItem({
			id: taskId,
			title: input.description,
			goal: prompt,
			ownerAgent: profile.name,
			inputs: {
				cwd: input.cwd,
				source: input.source ?? "background_task",
			},
		});
		const lease = this.kernel.acquireLease(kernelItem.id, profile.name);
		if (!lease.ok) {
			this.admission.release(taskId);
			return { error: lease.error ?? "failed to acquire kernel lease" };
		}

		const timeoutSec =
			typeof input.timeoutSec === "number" && Number.isFinite(input.timeoutSec)
				? Math.max(0, Math.floor(input.timeoutSec))
				: this.defaultTimeoutSec;

		const task: BackgroundTask = {
			id: taskId,
			description: input.description,
			prompt,
			cwd: input.cwd,
			agent: profile.name,
			backend: profile.backend,
			status: "queued",
			createdAt: Date.now(),
			timeoutSec,
			stderr: "",
			usage: emptyUsage(),
			idempotencyKey,
			workItemId: kernelItem.id,
		};
		this.tasks.set(task.id, task);
		this.queue.push(task.id);
		void this.processQueue();
		return { task };
	}

	private async processQueue(): Promise<void> {
		if (this.pumping) return;
		this.pumping = true;
		try {
			while (this.running.size < this.maxConcurrency && this.queue.length > 0) {
				const taskId = this.queue.shift();
				if (!taskId) continue;
				const task = this.tasks.get(taskId);
				if (!task || task.status !== "queued") continue;
				void this.runTask(task);
			}
		} finally {
			this.pumping = false;
		}
	}

	private async runTask(task: BackgroundTask): Promise<void> {
		const profile = this.agents.get(task.agent);
		if (!profile) {
			task.status = "error";
			task.error = `agent profile vanished: ${task.agent}`;
			task.completedAt = Date.now();
			task.durationMs = task.completedAt - task.createdAt;
			this.admission.release(task.id);
			return;
		}

		task.status = "running";
		task.startedAt = Date.now();
		this.running.add(task.id);
		this.kernel.transitionWorkItem(task.id, "running", {
			agent: task.agent,
			reason: "agent process started",
		});

		let runCwd = task.cwd;
		if (this.worktreeConfig.enabled && this.exec) {
			const worktree = await createWorktree({
				exec: this.exec,
				cwd: task.cwd,
				taskId: task.id,
				config: this.worktreeConfig,
			});
			if (worktree.info) {
				task.worktree = worktree.info;
				runCwd = worktree.info.path;
			}
		}

		const handle = this.spawnRunner({
			cwd: runCwd,
			prompt: task.prompt,
			agent: profile,
			timeoutSec: task.timeoutSec,
		});
		task.proc = handle.proc;
		task.pid = handle.proc.pid ?? undefined;

		const result = await handle.done;
		task.proc = undefined;
		task.completedAt = Date.now();
		task.durationMs = task.completedAt - (task.startedAt ?? task.createdAt);
		task.stderr = result.stderr;
		task.usage = result.usage;
		task.output = result.output;

		const cancelledByUser = this.tasks.get(task.id)?.status === "cancelled";
		if (cancelledByUser) {
			this.kernel.cancelWorkItem(task.id, task.agent, "cancelled by user");
		} else if (result.exitCode === 0 && !result.timedOut) {
			task.status = "completed";
			this.kernel.completeWithHandoff(task.id, {
				fromAgent: task.agent,
				summary: result.output || "task completed",
				nextAction: "no follow-up required",
				evals: [
					{
						name: "exit_code",
						passed: true,
						blocking: true,
						details: "exit code 0",
					},
				],
			});
		} else {
			task.status = "error";
			task.error = result.timedOut ? "task timed out" : `agent exited with ${result.exitCode}`;
			this.kernel.completeWithHandoff(task.id, {
				fromAgent: task.agent,
				summary: task.error,
				nextAction: "inspect stderr and retry",
				evals: [
					{
						name: "exit_code",
						passed: false,
						blocking: true,
						details: `exit code ${result.exitCode}`,
					},
				],
			});
		}

		if (this.exec && task.worktree) {
			const shouldCleanup =
				this.worktreeConfig.cleanup === "on-finish" ||
				(this.worktreeConfig.cleanup === "on-success" && task.status === "completed");
			if (shouldCleanup) {
				const removed = await removeWorktree(this.exec, task.worktree, {
					deleteBranch: true,
					timeout: 20_000,
				});
				if (!removed.ok) {
					task.stderr = `${task.stderr}\nworktree cleanup failed: ${removed.error ?? "unknown"}`.trim();
				}
			}
		}

		this.running.delete(task.id);
		this.admission.release(task.id);
		void this.processQueue();
	}

	cancel(taskId: string): boolean {
		const task = this.tasks.get(taskId);
		if (!task) return false;

		if (task.status === "queued") {
			task.status = "cancelled";
			task.completedAt = Date.now();
			task.durationMs = task.completedAt - task.createdAt;
			const queueIndex = this.queue.indexOf(taskId);
			if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
			this.kernel.cancelWorkItem(taskId, task.agent, "cancelled from queue");
			this.admission.release(task.id);
			return true;
		}

		if (task.status === "running") {
			task.status = "cancelled";
			try {
				task.proc?.kill("SIGTERM");
			} catch {
				// ignore
			}
			return true;
		}

		return false;
	}

	getTask(taskId: string): BackgroundTask | undefined {
		return this.tasks.get(taskId);
	}

	listTasks(): BackgroundTask[] {
		return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
	}

	getKernel(): HarnessKernel {
		return this.kernel;
	}

	getGuardrails(): GuardrailMemory {
		return this.guardrails;
	}

	getIdempotencyLedger(): IdempotencyLedger {
		return this.idempotency;
	}

	getAdmissionController(): AdmissionController {
		return this.admission;
	}

	snapshot(): {
		queued: number;
		running: number;
		maxConcurrency: number;
		kernel: ReturnType<HarnessKernel["getSnapshot"]>;
	} {
		return {
			queued: this.queue.length,
			running: this.running.size,
			maxConcurrency: this.maxConcurrency,
			kernel: this.kernel.getSnapshot(),
		};
	}
}
