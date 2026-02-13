import type { TemporalLoopDeps, TemporalLoopState, ToolResult } from "./types";

const LOOP_CUSTOM_TYPE = "oh-my-creampi.temporal-loop";

type EntryLike = {
	type?: string;
	customType?: string;
	data?: unknown;
};

type IterationMetrics = {
	linesChanged?: number;
	progressHash?: string;
};

function makeDefaultState(): TemporalLoopState {
	return {
		active: false,
		completed: false,
		condition: "",
		iterations: 0,
		startedAt: 0,
	};
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export class TemporalLoopEngine {
	private readonly deps: TemporalLoopDeps;

	private state: TemporalLoopState = makeDefaultState();
	private lowNoveltyCount = 0;
	private stalledProgressCount = 0;
	private lastProgressHash?: string;

	constructor(deps: TemporalLoopDeps) {
		this.deps = deps;
	}

	start(condition: string): void {
		this.state = {
			active: true,
			completed: false,
			condition,
			iterations: 0,
			startedAt: Date.now(),
		};
		this.lowNoveltyCount = 0;
		this.stalledProgressCount = 0;
		this.lastProgressHash = undefined;

		this.persist({
			event: "temporal-loop.started",
			condition,
			startedAt: this.state.startedAt,
		});
	}

	stop(): void {
		if (!this.state.active) return;

		this.state.active = false;
		this.state.completed = false;
		this.lowNoveltyCount = 0;
		this.stalledProgressCount = 0;
		this.lastProgressHash = undefined;

		this.persist({
			event: "temporal-loop.stopped",
			iterations: this.state.iterations,
		});
	}

	signalSuccess(summary?: string): ToolResult {
		if (!this.state.active) {
			return {
				content: [{ type: "text", text: "No active temporal loop to signal." }],
				details: { error: "no_active_temporal_loop" },
				isError: true,
			};
		}

		this.state.completed = true;
		this.state.active = false;
		this.state.summary = summary;
		this.lowNoveltyCount = 0;
		this.stalledProgressCount = 0;
		this.lastProgressHash = undefined;

		this.persist({
			event: "temporal-loop.completed",
			iterations: this.state.iterations,
			summary,
		});

		return {
			content: [
				{
					type: "text",
					text: `Temporal loop completed after ${this.state.iterations} iteration(s).${summary ? `\nSummary: ${summary}` : ""}`,
				},
			],
			details: {
				iterations: this.state.iterations,
				summary,
			},
		};
	}

	onAgentEnd(metrics?: IterationMetrics): void {
		if (!this.state.active || this.state.completed) return;

		this.state.iterations += 1;

		this.persist({
			event: "temporal-loop.iteration",
			iteration: this.state.iterations,
		});

		if (typeof metrics?.linesChanged === "number") {
			if (metrics.linesChanged < 5) this.lowNoveltyCount += 1;
			else this.lowNoveltyCount = 0;
		}

		if (typeof metrics?.progressHash === "string") {
			if (this.lastProgressHash && this.lastProgressHash === metrics.progressHash) {
				this.stalledProgressCount += 1;
			} else {
				this.stalledProgressCount = 0;
			}
			this.lastProgressHash = metrics.progressHash;
		}

		if (this.lowNoveltyCount >= 3 || this.stalledProgressCount >= 3) {
			const reason = this.lowNoveltyCount >= 3 ? "diff_entropy" : "maintenance_spiral";
			this.state.active = false;
			this.state.completed = false;
			this.persist({
				event: "temporal-loop.terminated",
				reason,
				lowNoveltyCount: this.lowNoveltyCount,
				stalledProgressCount: this.stalledProgressCount,
			});
			this.deps.sendMessage(
				`Temporal loop auto-stopped due to ${reason}. Call /creampi-loop status to inspect state and restart only if justified.`,
			);
			return;
		}

		const nudge =
			this.state.iterations === 1
				? `The loop condition has not been met yet: "${this.state.condition}". Continue working. Call signal_loop_success when the condition is satisfied.`
				: `Loop iteration ${this.state.iterations}. Condition still not met: "${this.state.condition}". Keep going. Call signal_loop_success when done.`;

		this.deps.sendMessage(nudge);
	}

	onBeforeCompact(event: { customInstructions?: string }): void {
		if (!this.state.active || this.state.completed) return;

		const loopInstructions = [
			"[CREAMPI TEMPORAL LOOP ACTIVE]",
			`Condition: ${this.state.condition}`,
			`Iterations so far: ${this.state.iterations}`,
			"You MUST call signal_loop_success when the condition is satisfied.",
			"Do NOT stop working until the condition is met.",
		].join("\n");

		event.customInstructions = event.customInstructions
			? `${event.customInstructions.trimEnd()}\n\n${loopInstructions}`
			: loopInstructions;
	}

	restoreFromEntries(entries: Array<EntryLike>): void {
		this.state = makeDefaultState();
		this.lowNoveltyCount = 0;
		this.stalledProgressCount = 0;
		this.lastProgressHash = undefined;

		for (const entry of entries) {
			if (entry.type !== "custom" || entry.customType !== LOOP_CUSTOM_TYPE) {
				continue;
			}

			if (!isObjectRecord(entry.data)) {
				continue;
			}

			const eventName = String(entry.data.event ?? "");

			if (eventName === "temporal-loop.started") {
				this.state = {
					active: true,
					completed: false,
					condition: String(entry.data.condition ?? ""),
					iterations: 0,
					startedAt: Number(entry.data.startedAt ?? Date.now()),
				};
				continue;
			}

			if (eventName === "temporal-loop.iteration") {
				this.state.iterations = Number(entry.data.iteration ?? this.state.iterations + 1);
				continue;
			}

			if (eventName === "temporal-loop.completed") {
				this.state.active = false;
				this.state.completed = true;
				if (typeof entry.data.summary === "string") {
					this.state.summary = entry.data.summary;
				}
				continue;
			}

			if (eventName === "temporal-loop.stopped") {
				this.state.active = false;
				this.state.completed = false;
				continue;
			}

			if (eventName === "temporal-loop.terminated") {
				this.state.active = false;
				this.state.completed = false;
			}
		}
	}

	isActive(): boolean {
		return this.state.active;
	}

	getIterations(): number {
		return this.state.iterations;
	}

	getCondition(): string {
		return this.state.condition;
	}

	getState(): Readonly<TemporalLoopState> {
		return { ...this.state };
	}

	private persist(data: Record<string, unknown>): void {
		try {
			this.deps.appendEntry(LOOP_CUSTOM_TYPE, data);
		} catch (error) {
			void error;
		}
	}
}
