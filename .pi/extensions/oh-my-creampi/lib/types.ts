import type { ChildProcessWithoutNullStreams } from "node:child_process";

export type AgentBackend = "pi" | "claude" | "codex";

export type TaskStatus = "queued" | "running" | "completed" | "error" | "cancelled";

export type Severity = "info" | "warning" | "critical";

export type Usage = {
	turns: number;
	input: number;
	output: number;
	cost: number;
};

export type AgentProfile = {
	name: string;
	description: string;
	backend: AgentBackend;
	tools: string[];
	systemPrompt: string;
	provider?: string;
	model?: string;
	source?: "builtin" | "project";
	filePath?: string;
};

export type AgentOverride = Partial<Omit<AgentProfile, "name">>;

export type AgentRunRequest = {
	cwd: string;
	prompt: string;
	agent: AgentProfile;
	timeoutSec?: number;
	signal?: AbortSignal;
};

export type AgentRunResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	output: string;
	usage: Usage;
	timedOut?: boolean;
};

export type AgentRunHandle = {
	proc: ChildProcessWithoutNullStreams;
	done: Promise<AgentRunResult>;
};

export type BackgroundLaunchInput = {
	description: string;
	prompt: string;
	agent: string;
	cwd: string;
	timeoutSec?: number;
	source?: string;
	domain?: string;
};

export type BackgroundTask = {
	id: string;
	description: string;
	prompt: string;
	cwd: string;
	agent: string;
	backend: AgentBackend;
	status: TaskStatus;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	durationMs?: number;
	timeoutSec?: number;
	output?: string;
	error?: string;
	stderr: string;
	usage: Usage;
	pid?: number;
	proc?: ChildProcessWithoutNullStreams;
	idempotencyKey?: string;
	workItemId?: string;
};

export type CreamPiBackendConfig = {
	provider: string;
	model: string;
};

export type CreamPiConfig = {
	defaultAgent: string;
	defaultBackend: AgentBackend;
	defaultModel: string;
	maxConcurrency: number;
	defaultTimeoutSec: number;
	guardrailsDir: string;
	idempotencyDir: string;
	idempotencyTtlSec: number;
	checkpointsDir: string;
	backends: Partial<Record<AgentBackend, CreamPiBackendConfig>>;
};

export type ToolTextContent = { type: "text"; text: string };

export type ToolResult = {
	content: ToolTextContent[];
	details?: Record<string, unknown>;
	isError?: boolean;
};

export type ToolExecuteContext = {
	cwd: string;
	hasUI: boolean;
	ui?: {
		notify(message: string, type?: "info" | "success" | "warning" | "error"): void;
		setStatus(key: string, value: string): void;
	};
};

export type ToolExecute<TParams extends Record<string, unknown>> = (
	toolCallId: string,
	params: TParams,
	signal: AbortSignal | undefined,
	onUpdate: ((update: { message?: string }) => void) | undefined,
	ctx: ToolExecuteContext,
) => Promise<ToolResult> | ToolResult;

export type RegisteredTool<TParams extends Record<string, unknown> = Record<string, unknown>> = {
	name: string;
	label?: string;
	description: string;
	parameters?: unknown;
	execute: ToolExecute<TParams>;
};

export type RegisteredCommand = {
	description: string;
	handler: (args: string, ctx: ToolExecuteContext) => Promise<void> | void;
};

export type ExtensionExecResult = {
	code: number;
	stdout: string;
	stderr: string;
};

export type ExtensionAPI = {
	registerTool<TParams extends Record<string, unknown>>(tool: RegisteredTool<TParams>): void;
	registerCommand(name: string, command: RegisteredCommand): void;
	exec?(bin: string, args: string[], options: { cwd: string; timeout?: number }): Promise<ExtensionExecResult>;
	on?(eventName: string, handler: (event: unknown, ctx: ToolExecuteContext) => unknown): void;
	sendUserMessage?(message: string): void;
	appendEntry?(customType: string, data: unknown): void;
};

// ── Worktree types ──────────────────────────────────────────

export type WorktreeCleanup = "never" | "on-success" | "on-finish";

export type WorktreeConfig = {
	enabled: boolean;
	dir: string;
	branchPrefix: string;
	cleanup: WorktreeCleanup;
};

export type WorktreeInfo = {
	taskId: string;
	path: string;
	branch: string;
	gitRoot: string;
	baseBranch: string;
};

// ── Temporal Loop types ─────────────────────────────────────

export type TemporalLoopState = {
	active: boolean;
	completed: boolean;
	condition: string;
	iterations: number;
	startedAt: number;
	summary?: string;
};

export type TemporalLoopDeps = {
	sendMessage: (msg: string) => void;
	appendEntry: (type: string, data: unknown) => void;
};

// ── Self-Recursion types ────────────────────────────────────

export type SelfQueryRequest = {
	prompt: string;
	agent?: string;
	timeoutSec?: number;
	context?: string;
};

export type SelfQueryResult = {
	output: string;
	exitCode: number;
	usage: Usage;
	depth: number;
	taskId: string;
};

export type SelfRecursionConfig = {
	maxDepth: number;
	childModelOverride?: string;
	budgetDivision: "equal" | "halving";
};

// ── Kernel Awareness types ──────────────────────────────────

export type KernelAwareness = {
	raw: string;
	available: boolean;
};
