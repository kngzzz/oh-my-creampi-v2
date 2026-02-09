import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { GuardrailMemory, IdempotencyLedger, type PolicyConfig } from "../lib/primitives";
import { LoopRuntime } from "../lib/loops/runtime";
import type { LoopDefinition } from "../lib/loops/types";
import { makeTempDir } from "./helpers";

function makeLoop(overrides: Partial<LoopDefinition> = {}): LoopDefinition {
	return {
		name: "demo-loop",
		version: 1,
		description: "demo",
		trigger: { type: "manual" },
		agent: "oracle",
		backend: "pi",
		timeoutSec: 60,
		maxConcurrent: 1,
		cooldownSec: 0,
		maxRetries: 0,
		inputs: { market: "ETH" },
		budget: {},
		eval: { type: "exit_code", passCondition: 0, blocking: true },
		promptTemplate: "Analyze {market}",
		filePath: "loop.md",
		updatedAt: Date.now(),
		...overrides,
	};
}

function setupRuntime(options?: { loop?: LoopDefinition; policy?: PolicyConfig }) {
	const root = makeTempDir();
	const guardrails = new GuardrailMemory(path.join(root, "guardrails"));
	const idempotency = new IdempotencyLedger({ dir: path.join(root, "idempotency"), ttlSec: 600 });
	const launches: Array<{ agent: string; description: string; prompt: string; cwd: string; timeoutSec: number; domain?: string }> = [];
	const loop = options?.loop ?? makeLoop();

	const runtime = new LoopRuntime({
		loops: [loop],
		checkpointsDir: path.join(root, "checkpoints"),
		idempotencyLedger: idempotency,
		guardrails,
		policyConfig: options?.policy,
		launch: async (input) => {
			launches.push(input);
			return { taskId: `bg-${launches.length}` };
		},
	});

	return { runtime, launches, guardrails, loop, root };
}

test("loop runtime returns error for unknown loop", async () => {
	const { runtime } = setupRuntime();
	const result = await runtime.triggerLoop({ loopName: "missing", cwd: process.cwd() });
	assert.equal(result.status, "error");
	assert.match(result.reason ?? "", /loop not found/);
});

test("loop runtime blocks shouldRun false condition", async () => {
	const { runtime, launches } = setupRuntime({ loop: makeLoop({ shouldRun: "1 == 2" }) });
	const result = await runtime.triggerLoop({ loopName: "demo-loop", cwd: process.cwd(), triggerSource: "manual" });
	assert.equal(result.status, "skipped");
	assert.equal(launches.length, 0);
	assert.ok(result.phases.some((phase) => phase.name === "shouldRun" && phase.status === "skipped"));
});

test("loop runtime blocks when loop policy denies trigger", async () => {
	const { runtime, launches } = setupRuntime({
		policy: {
			loopTrigger: {
				deniedAgents: ["oracle"],
			},
		},
	});
	const result = await runtime.triggerLoop({ loopName: "demo-loop", cwd: process.cwd() });
	assert.equal(result.status, "error");
	assert.equal(launches.length, 0);
});

test("loop runtime blocks duplicate triggers via idempotency", async () => {
	const { runtime } = setupRuntime();
	const first = await runtime.triggerLoop({ loopName: "demo-loop", cwd: process.cwd(), triggerSource: "cron" });
	const second = await runtime.triggerLoop({ loopName: "demo-loop", cwd: process.cwd(), triggerSource: "cron" });
	assert.equal(first.status, "launched");
	assert.equal(second.status, "duplicate");
});

test("loop runtime supports dry run prepared state", async () => {
	const { runtime, launches } = setupRuntime();
	const result = await runtime.triggerLoop({
		loopName: "demo-loop",
		cwd: process.cwd(),
		triggerSource: "manual",
		dryRun: true,
	});
	assert.equal(result.status, "prepared");
	assert.equal(launches.length, 0);
});

test("loop runtime records full 8-phase lifecycle for launch", async () => {
	const { runtime } = setupRuntime();
	const result = await runtime.triggerLoop({ loopName: "demo-loop", cwd: process.cwd(), triggerSource: "manual" });
	assert.equal(result.status, "launched");
	assert.equal(result.phases.length, 8);
	assert.deepEqual(result.phases.map((phase) => phase.name), [
		"trigger",
		"shouldRun",
		"context",
		"execute",
		"evaluate",
		"learn",
		"handoff",
		"retrigger",
	]);
});

test("loop runtime blocks rerun during cooldown", async () => {
	const { runtime } = setupRuntime({ loop: makeLoop({ cooldownSec: 3_600 }) });
	const first = await runtime.triggerLoop({ loopName: "demo-loop", cwd: process.cwd(), triggerSource: "manual" });
	const second = await runtime.triggerLoop({ loopName: "demo-loop", cwd: process.cwd(), triggerSource: "manual" });
	assert.equal(first.status, "launched");
	assert.equal(second.status, "skipped");
	assert.match(second.reason ?? "", /cooldown/);
});

test("loop runtime injects guardrails into launched prompt", async () => {
	const { runtime, launches, guardrails } = setupRuntime();
	await guardrails.append("demo-loop", "Always verify outputs", "warning");
	await runtime.triggerLoop({ loopName: "demo-loop", cwd: process.cwd(), triggerSource: "manual" });
	assert.equal(launches.length, 1);
	assert.match(launches[0]?.prompt ?? "", /# Guardrails/);
	assert.match(launches[0]?.prompt ?? "", /Always verify outputs/);
});

test("loop runtime status reads persisted checkpoint", async () => {
	const { runtime } = setupRuntime();
	await runtime.triggerLoop({ loopName: "demo-loop", cwd: process.cwd(), triggerSource: "manual" });
	const statuses = await runtime.getStatus();
	assert.equal(statuses.length, 1);
	assert.equal(statuses[0]?.name, "demo-loop");
	assert.equal(statuses[0]?.status, "launched");
	assert.ok(statuses[0]?.lastRun);
});
