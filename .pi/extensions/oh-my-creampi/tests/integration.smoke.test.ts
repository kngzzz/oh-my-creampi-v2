import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { AgentRegistry, getBuiltinAgentProfiles } from "../lib/agents";
import { BackgroundTaskManager } from "../lib/background";
import { LoopRuntime } from "../lib/loops/runtime";
import type { LoopDefinition } from "../lib/loops/types";
import { GuardrailMemory, IdempotencyLedger } from "../lib/primitives";
import { makeSpawnRunner, makeTempDir } from "./helpers";

function writeKernelAwareness(root: string, content: string): void {
	const piDir = path.join(root, ".pi");
	fs.mkdirSync(piDir, { recursive: true });
	fs.writeFileSync(path.join(piDir, "kernel-awareness.md"), content, "utf8");
}

test("background manager composes kernel awareness and guardrails into prompt", async () => {
	const root = makeTempDir();
	writeKernelAwareness(root, "Always define done criteria.");

	const manager = new BackgroundTaskManager({
		agents: new AgentRegistry(getBuiltinAgentProfiles()),
		maxConcurrency: 1,
		defaultTimeoutSec: 30,
		projectRoot: root,
		guardrailsDir: path.join(root, "guardrails"),
		idempotencyDir: path.join(root, "idempotency"),
		idempotencyTtlSec: 60,
		spawnRunner: makeSpawnRunner({ output: "ok" }),
	});

	await manager.getGuardrails().append("sisyphus", "Run tests before reporting done", "warning");
	const launched = await manager.launch({
		description: "test",
		prompt: "Implement a focused change",
		agent: "sisyphus",
		cwd: root,
	});

	assert.ok(launched.task);
	assert.match(launched.task?.prompt ?? "", /## Kernel Awareness/);
	assert.match(launched.task?.prompt ?? "", /Always define done criteria/);
	assert.match(launched.task?.prompt ?? "", /## Guardrails \(lessons from past runs\)/);
	assert.match(launched.task?.prompt ?? "", /Run tests before reporting done/);
});

test("loop runtime composes kernel awareness and marks prompt as precomposed", async () => {
	const root = makeTempDir();
	writeKernelAwareness(root, "Stay within requested scope.");

	const guardrails = new GuardrailMemory(path.join(root, "guardrails"));
	const idempotency = new IdempotencyLedger({ dir: path.join(root, "idempotency"), ttlSec: 600 });
	const launches: Array<{ prompt: string; promptComposed?: boolean }> = [];

	const loop: LoopDefinition = {
		name: "integration-loop",
		version: 1,
		description: "integration",
		trigger: { type: "manual" },
		agent: "oracle",
		backend: "pi",
		timeoutSec: 60,
		maxConcurrent: 1,
		cooldownSec: 0,
		maxRetries: 0,
		inputs: { target: "src" },
		budget: {},
		eval: { type: "exit_code", passCondition: 0, blocking: true },
		promptTemplate: "Review {target}",
		filePath: "integration.md",
		updatedAt: Date.now(),
	};

	const runtime = new LoopRuntime({
		loops: [loop],
		checkpointsDir: path.join(root, "checkpoints"),
		projectRoot: root,
		idempotencyLedger: idempotency,
		guardrails,
		launch: async (input) => {
			launches.push({ prompt: input.prompt, promptComposed: input.promptComposed });
			return { taskId: "bg-1" };
		},
	});

	await guardrails.append("integration-loop", "Return concise findings", "info");
	const result = await runtime.triggerLoop({ loopName: "integration-loop", cwd: root, triggerSource: "manual" });

	assert.equal(result.status, "launched");
	assert.equal(launches.length, 1);
	assert.match(launches[0]?.prompt ?? "", /## Kernel Awareness/);
	assert.match(launches[0]?.prompt ?? "", /Stay within requested scope/);
	assert.match(launches[0]?.prompt ?? "", /## Guardrails \(lessons from past runs\)/);
	assert.match(launches[0]?.prompt ?? "", /Return concise findings/);
	assert.equal(launches[0]?.promptComposed, true);
});
