import { checkCli } from "../index-helpers";
import type { EnsureRuntime } from "../runtime-types";
import type { TemporalLoopEngine } from "../temporal-loop";
import type { ExtensionAPI } from "../types";
import { initializeWorkspace } from "../workspace-init";

type RegisterCommandsOptions = {
	ensureRuntime: EnsureRuntime;
	temporalLoop: TemporalLoopEngine;
};

export function registerCommands(pi: ExtensionAPI, options: RegisterCommandsOptions): void {
	const { ensureRuntime, temporalLoop } = options;

	pi.registerCommand("creampi", {
		description: "Show CreamPi dashboard status.",
		handler: async (_args, ctx) => {
			const rt = ensureRuntime(ctx.cwd);
			const loops = await rt.loopRuntime.getStatus();
			const guardrailCounts = await rt.background.getGuardrails().countByDomain();
			const snapshot = rt.background.snapshot();
			const text = [
				"oh-my-creampi v2",
				`Root: ${rt.root}`,
				rt.configPath ? `Config: ${rt.configPath}` : "Config: default",
				`Background: queued=${snapshot.queued}, running=${snapshot.running}, concurrency=${snapshot.maxConcurrency}`,
				`Loops: ${loops.length}`,
				`Guardrail domains: ${Object.keys(guardrailCounts).length}`,
				rt.configWarnings.length ? `Warnings: ${rt.configWarnings.join(" | ")}` : "Warnings: none",
				rt.loopWarnings.length ? `Loop warnings: ${rt.loopWarnings.join(" | ")}` : "Loop warnings: none",
			].join("\n");
			if (ctx.hasUI && ctx.ui) {
				ctx.ui.notify(text, "info");
			} else {
				console.log(text);
			}
		},
	});

	pi.registerCommand("creampi-loops", {
		description: "List loops with trigger history and next schedule.",
		handler: async (_args, ctx) => {
			const rt = ensureRuntime(ctx.cwd);
			const loops = await rt.loopRuntime.getStatus();
			const text = loops.length
				? ["CreamPi loops", ...loops.map((loop) => `- ${loop.name}: ${loop.status}${loop.nextScheduled ? ` (next ${loop.nextScheduled})` : ""}`)].join("\n")
				: "No loops discovered.";
			if (ctx.hasUI && ctx.ui) ctx.ui.notify(text, "info");
			else console.log(text);
		},
	});

	pi.registerCommand("creampi-health", {
		description: "Check backend CLI availability for pi/claude/codex.",
		handler: async (_args, ctx) => {
			const piHealth = await checkCli(pi, ctx, "pi", ["--version"]);
			const claudeHealth = await checkCli(pi, ctx, "claude", ["--version"]);
			const codexHealth = await checkCli(pi, ctx, "codex", ["--version"]);
			const lines = [
				"CreamPi health",
				`- pi: ${piHealth.ready ? "ready" : "missing"} (${piHealth.detail})`,
				`- claude: ${claudeHealth.ready ? "ready" : "missing"} (${claudeHealth.detail})`,
				`- codex: ${codexHealth.ready ? "ready" : "missing"} (${codexHealth.detail})`,
			];
			const text = lines.join("\n");
			if (ctx.hasUI && ctx.ui) ctx.ui.notify(text, "info");
			else console.log(text);
		},
	});

	pi.registerCommand("creampi-init", {
		description: "Initialize CreamPi workspace files for current project.",
		handler: async (_args, ctx) => {
			const rt = ensureRuntime(ctx.cwd);
			const root = rt.root;
			await initializeWorkspace(root);

			const text = `CreamPi workspace initialized at ${root}`;
			if (ctx.hasUI && ctx.ui) ctx.ui.notify(text, "success");
			else console.log(text);
		},
	});

	pi.registerCommand("creampi-loop", {
		description: "Control temporal loop state: start <condition> | stop | status.",
		handler: async (args, ctx) => {
			const input = args.trim();
			if (!input || input === "status") {
				const state = temporalLoop.getState();
				const text = [
					"CreamPi temporal loop",
					`- active: ${state.active ? "yes" : "no"}`,
					`- completed: ${state.completed ? "yes" : "no"}`,
					`- condition: ${state.condition || "(none)"}`,
					`- iterations: ${state.iterations}`,
				].join("\n");
				if (ctx.hasUI && ctx.ui) ctx.ui.notify(text, "info");
				else console.log(text);
				return;
			}

			if (input === "stop") {
				temporalLoop.stop();
				const text = "Temporal loop stopped.";
				if (ctx.hasUI && ctx.ui) ctx.ui.notify(text, "info");
				else console.log(text);
				return;
			}

			if (input.startsWith("start ")) {
				const condition = input.slice("start ".length).trim();
				if (!condition) {
					const text = "Usage: /creampi-loop start <condition>";
					if (ctx.hasUI && ctx.ui) ctx.ui.notify(text, "warning");
					else console.log(text);
					return;
				}
				temporalLoop.start(condition);
				const text = `Temporal loop started: ${condition}`;
				if (ctx.hasUI && ctx.ui) ctx.ui.notify(text, "success");
				else console.log(text);
				return;
			}

			const text = "Usage: /creampi-loop [status|stop|start <condition>]";
			if (ctx.hasUI && ctx.ui) ctx.ui.notify(text, "warning");
			else console.log(text);
		},
	});
}
