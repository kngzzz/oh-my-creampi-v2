import * as fs from "node:fs";
import * as path from "node:path";

import { AgentRegistry, getBuiltinAgentProfiles, mergeAgentProfiles } from "./lib/agents";
import { discoverProjectAgentProfiles } from "./lib/agent-loader";
import { BackgroundTaskManager } from "./lib/background";
import { registerCommands } from "./lib/commands/register-commands";
import { DEFAULT_CONFIG, loadCreamPiConfig, resolveProjectRoot } from "./lib/config";
import { resolveStoragePath } from "./lib/index-helpers";
import { discoverProjectLoopDefinitions } from "./lib/loops/loader";
import { LoopRuntime } from "./lib/loops/runtime";
import type { RuntimeState } from "./lib/runtime-types";
import { SelfRecursionEngine } from "./lib/self-recursion";
import { TemporalLoopEngine } from "./lib/temporal-loop";
import { registerTools } from "./lib/tools/register-tools";
import type { ExtensionAPI } from "./lib/types";
import { sha256Hex } from "./lib/util";

export default function ohMyCreamPi(pi: ExtensionAPI): void {
	let runtime: RuntimeState | undefined;
	const temporalLoop = new TemporalLoopEngine({
		sendMessage: (message) => {
			if (pi.sendUserMessage) pi.sendUserMessage(message);
		},
		appendEntry: (customType, data) => {
			if (pi.appendEntry) pi.appendEntry(customType, data);
		},
	});

	const collectIterationMetrics = async (cwd: string): Promise<{ linesChanged?: number; progressHash?: string }> => {
		let linesChanged: number | undefined;
		if (pi.exec) {
			const diff = await pi.exec("git", ["diff", "--numstat"], { cwd, timeout: 5_000 }).catch(() => undefined);
			if (diff && diff.code === 0) {
				linesChanged = diff.stdout
					.split("\n")
					.filter((line: string) => line.trim().length > 0)
					.reduce((sum: number, line: string) => {
						const [adds, removes] = line.split("\t");
						const addValue = /^\d+$/.test(adds ?? "") ? Number(adds) : 0;
						const removeValue = /^\d+$/.test(removes ?? "") ? Number(removes) : 0;
						return sum + addValue + removeValue;
					}, 0);
			}
		}

		let progressHash: string | undefined;
		const progressPath = path.join(cwd, "progress.json");
		try {
			const content = await fs.promises.readFile(progressPath, "utf8");
			progressHash = sha256Hex(content);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ENOENT") {
				progressHash = undefined;
			}
		}

		return { linesChanged, progressHash };
	};

	const ensureRuntime = (cwd: string): RuntimeState => {
		const loaded = loadCreamPiConfig(cwd);
		const root = resolveProjectRoot(cwd, loaded.path);
		if (runtime && runtime.root === root) {
			return runtime;
		}

		const discoveredAgents = discoverProjectAgentProfiles(cwd);
		const discoveredLoops = discoverProjectLoopDefinitions(cwd);

		const mergedAgents = mergeAgentProfiles(getBuiltinAgentProfiles(), discoveredAgents.agents);
		const agents = new AgentRegistry(mergedAgents);

		const config = loaded.config ?? DEFAULT_CONFIG;
		const background = new BackgroundTaskManager({
			agents,
			maxConcurrency: config.maxConcurrency,
			defaultTimeoutSec: config.defaultTimeoutSec,
			projectRoot: root,
			worktreeConfig: config.worktree,
			exec: pi.exec,
			guardrailsDir: resolveStoragePath(root, config.guardrailsDir),
			idempotencyDir: resolveStoragePath(root, config.idempotencyDir),
			idempotencyTtlSec: config.idempotencyTtlSec,
		});

		const loopRuntime = new LoopRuntime({
			loops: discoveredLoops.loops,
			projectRoot: root,
			checkpointsDir: resolveStoragePath(root, config.checkpointsDir),
			idempotencyLedger: background.getIdempotencyLedger(),
			guardrails: background.getGuardrails(),
			launch: async (launchInput) => {
				const launched = await background.launch({
					description: launchInput.description,
					prompt: launchInput.prompt,
					promptComposed: launchInput.promptComposed,
					agent: launchInput.agent,
					cwd: launchInput.cwd,
					timeoutSec: launchInput.timeoutSec,
					source: "loop_trigger",
					domain: launchInput.domain,
				});
				return {
					taskId: launched.task?.id,
					error: launched.error,
				};
			},
			idempotencyTtlSec: config.idempotencyTtlSec,
		});
		const selfRecursion = new SelfRecursionEngine({ agents });

		runtime = {
			root,
			configPath: loaded.path,
			configWarnings: [...loaded.warnings, ...discoveredAgents.warnings],
			loopWarnings: discoveredLoops.warnings,
			agents,
			background,
			loopRuntime,
			selfRecursion,
		};
		return runtime;
	};

	registerTools(pi, { ensureRuntime, temporalLoop });
	registerCommands(pi, { ensureRuntime, temporalLoop });

	const restoreTemporalLoop = (event: unknown): void => {
		if (!event || typeof event !== "object") return;
		const record = event as Record<string, unknown>;
		const entries =
			(Array.isArray(record.entries) ? record.entries : undefined) ??
			(Array.isArray(record.sessionEntries) ? record.sessionEntries : undefined);
		if (!entries) return;
		temporalLoop.restoreFromEntries(
			entries.map((entry) => {
				if (!entry || typeof entry !== "object") return {};
				const item = entry as Record<string, unknown>;
				return {
					type: typeof item.type === "string" ? item.type : undefined,
					customType: typeof item.customType === "string" ? item.customType : undefined,
					data: item.data,
				};
			}),
		);
	};

	if (pi.on) {
		pi.on("session_start", (event, ctx) => {
			ensureRuntime(ctx.cwd);
			restoreTemporalLoop(event);
		});
		pi.on("session_switch", (event, ctx) => {
			ensureRuntime(ctx.cwd);
			restoreTemporalLoop(event);
		});
		pi.on("agent_end", async (_event, ctx) => {
			const metrics = await collectIterationMetrics(ctx.cwd);
			temporalLoop.onAgentEnd(metrics);
		});
		pi.on("session_before_compact", (event) => {
			if (!event || typeof event !== "object") return;
			const compactEvent = event as Record<string, unknown>;
			const target = {
				customInstructions:
					typeof compactEvent.customInstructions === "string"
						? compactEvent.customInstructions
						: undefined,
			};
			temporalLoop.onBeforeCompact(target);
			compactEvent.customInstructions = target.customInstructions;
		});
	}
}
