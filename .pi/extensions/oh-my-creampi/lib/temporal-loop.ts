import type { TemporalLoopDeps, TemporalLoopState, ToolResult } from "./types";

const LOOP_CUSTOM_TYPE = "oh-my-creampi.temporal-loop";

type EntryLike = {
	type?: string;
	customType?: string;
	data?: unknown;
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

	onAgentEnd(): void {
		if (!this.state.active || this.state.completed) return;

		this.state.iterations += 1;

		this.persist({
			event: "temporal-loop.iteration",
			iteration: this.state.iterations,
		});

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
