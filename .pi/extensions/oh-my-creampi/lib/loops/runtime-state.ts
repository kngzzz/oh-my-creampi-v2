import { LOOP_PHASE_ORDER, type LoopPhaseName, type LoopTriggerResultStatus } from "./types";

export type LoopRuntimeState = {
	loopName: string;
	runId: string;
	phase: LoopPhaseName;
	seq: number;
	updatedAt: string;
	terminal: boolean;
	terminalStatus?: LoopTriggerResultStatus;
};

const PHASE_INDEX = new Map<LoopPhaseName, number>(
	LOOP_PHASE_ORDER.map((phase, index) => [phase, index]),
);

function requireNonEmpty(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${label} is required`);
	return normalized;
}

export function initializeLoopRuntimeState(loopName: string, runId: string): LoopRuntimeState {
	return {
		loopName: requireNonEmpty(loopName, "loopName"),
		runId: requireNonEmpty(runId, "runId"),
		phase: "trigger",
		seq: 1,
		updatedAt: new Date().toISOString(),
		terminal: false,
	};
}

export function advanceLoopRuntimeState(state: LoopRuntimeState, phase: LoopPhaseName): LoopRuntimeState {
	if (state.terminal) {
		throw new Error(`cannot advance phase for terminal loop state (${state.terminalStatus ?? "unknown"})`);
	}
	const currentIndex = PHASE_INDEX.get(state.phase);
	const nextIndex = PHASE_INDEX.get(phase);
	if (currentIndex === undefined || nextIndex === undefined) {
		throw new Error("invalid phase transition");
	}
	if (nextIndex !== currentIndex + 1) {
		throw new Error(`invalid phase transition ${state.phase} -> ${phase}`);
	}
	return {
		...state,
		phase,
		seq: state.seq + 1,
		updatedAt: new Date().toISOString(),
	};
}

export function markLoopRuntimeTerminal(
	state: LoopRuntimeState,
	status: LoopTriggerResultStatus,
): LoopRuntimeState {
	return {
		...state,
		terminal: true,
		terminalStatus: status,
		seq: state.seq + 1,
		updatedAt: new Date().toISOString(),
	};
}
