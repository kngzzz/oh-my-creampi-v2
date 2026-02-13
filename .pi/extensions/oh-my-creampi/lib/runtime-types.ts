import type { AgentRegistry } from "./agents";
import type { BackgroundTaskManager } from "./background";
import type { LoopRuntime } from "./loops/runtime";
import type { SelfRecursionEngine } from "./self-recursion";

export type RuntimeState = {
	root: string;
	configPath: string | null;
	configWarnings: string[];
	loopWarnings: string[];
	agents: AgentRegistry;
	background: BackgroundTaskManager;
	loopRuntime: LoopRuntime;
	selfRecursion: SelfRecursionEngine;
};

export type EnsureRuntime = (cwd: string) => RuntimeState;
