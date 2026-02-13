import { createId } from "./util";
import { spawnAgentRun } from "./agent-runner";
import { AgentRegistry } from "./agents";
import type { AgentRunRequest, AgentRunResult, SelfQueryRequest, SelfQueryResult, SelfRecursionConfig } from "./types";

type SpawnRunner = (request: AgentRunRequest) => { done: Promise<AgentRunResult> };

type SelfRecursionEngineOptions = {
	agents: AgentRegistry;
	spawnRunner?: SpawnRunner;
	config?: Partial<SelfRecursionConfig>;
};

type SelfRecursionQueryOptions = {
	cwd: string;
};

function readCurrentDepth(): number {
	const raw = process.env.CREAMPI_SELF_DEPTH;
	if (!raw) return 0;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return 0;
	return Math.max(0, Math.floor(parsed));
}

function composePrompt(request: SelfQueryRequest, depth: number): string {
	const context = request.context?.trim();
	if (!context) return request.prompt;
	return [`[SELF_QUERY_CONTEXT depth=${depth}]`, context, "---", request.prompt].join("\n\n");
}

export class SelfRecursionEngine {
	private readonly agents: AgentRegistry;
	private readonly spawnRunner: SpawnRunner;
	private readonly config: SelfRecursionConfig;

	constructor(options: SelfRecursionEngineOptions) {
		this.agents = options.agents;
		this.spawnRunner = options.spawnRunner ?? spawnAgentRun;
		this.config = {
			maxDepth: options.config?.maxDepth ?? 3,
			childModelOverride: options.config?.childModelOverride,
			budgetDivision: options.config?.budgetDivision ?? "halving",
		};
	}

	async query(request: SelfQueryRequest, options: SelfRecursionQueryOptions): Promise<{ result?: SelfQueryResult; error?: string }> {
		const profile = request.agent ? this.agents.get(request.agent) : this.agents.resolve(undefined);
		if (!profile) return { error: `unknown agent profile: ${request.agent ?? "(default)"}` };

		const currentDepth = readCurrentDepth();
		const depth = currentDepth + 1;
		if (depth > this.config.maxDepth) {
			return { error: `self recursion depth ${depth} exceeds maxDepth=${this.config.maxDepth}` };
		}

		const taskId = createId("selfq");
		const prompt = composePrompt(request, depth);
		const agent = this.config.childModelOverride
			? {
				...profile,
				model: this.config.childModelOverride,
			}
			: profile;

		const handle = this.spawnRunner({
			cwd: options.cwd,
			prompt,
			agent,
			timeoutSec: request.timeoutSec,
		});
		const run = await handle.done;

		return {
			result: {
				taskId,
				depth,
				exitCode: run.exitCode,
				output: run.output,
				usage: run.usage,
			},
		};
	}
}
