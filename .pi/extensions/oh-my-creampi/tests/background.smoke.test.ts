import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { AgentRegistry, getBuiltinAgentProfiles } from "../lib/agents";
import { BackgroundTaskManager } from "../lib/background";
import type { PolicyConfig } from "../lib/primitives";
import { makeSpawnRunner, makeTempDir, waitFor } from "./helpers";

function setupBackground(options?: {
	maxConcurrency?: number;
	spawnExitCode?: number;
	spawnDelayMs?: number;
	policyConfig?: PolicyConfig;
}) {
	const root = makeTempDir();
	const manager = new BackgroundTaskManager({
		agents: new AgentRegistry(getBuiltinAgentProfiles()),
		maxConcurrency: options?.maxConcurrency ?? 2,
		defaultTimeoutSec: 30,
		policyConfig: options?.policyConfig,
		guardrailsDir: path.join(root, "guardrails"),
		idempotencyDir: path.join(root, "idempotency"),
		idempotencyTtlSec: 60,
		spawnRunner: makeSpawnRunner({
			exitCode: options?.spawnExitCode ?? 0,
			output: "task-output",
			delayMs: options?.spawnDelayMs ?? 0,
		}),
	});
	return { manager, root };
}

test("background manager launches task and completes successfully", async () => {
	const { manager } = setupBackground();
	const launched = await manager.launch({
		description: "run task",
		prompt: "do work",
		agent: "sisyphus",
		cwd: process.cwd(),
	});
	assert.ok(launched.task);
	await waitFor(() => manager.getTask(launched.task!.id)?.status === "completed");
	assert.equal(manager.getTask(launched.task!.id)?.output, "task-output");
});

test("background manager blocks policy violations", async () => {
	const { manager } = setupBackground({
		policyConfig: {
			backgroundTask: { deniedAgents: ["sisyphus"] },
		},
	});
	const launched = await manager.launch({
		description: "blocked",
		prompt: "do work",
		agent: "sisyphus",
		cwd: process.cwd(),
	});
	assert.ok(!launched.task);
	assert.match(launched.error ?? "", /policy/);
});

test("background manager blocks over-capacity admission", async () => {
	const { manager } = setupBackground({ maxConcurrency: 1, spawnDelayMs: 400 });
	const first = await manager.launch({
		description: "first",
		prompt: "do first",
		agent: "sisyphus",
		cwd: process.cwd(),
	});
	assert.ok(first.task);
	const second = await manager.launch({
		description: "second",
		prompt: "do second",
		agent: "oracle",
		cwd: process.cwd(),
	});
	assert.ok(!second.task);
	assert.match(second.error ?? "", /over capacity/);
});

test("background manager blocks duplicate launches with idempotency", async () => {
	const { manager } = setupBackground({ spawnDelayMs: 300 });
	const first = await manager.launch({
		description: "dup",
		prompt: "same-prompt",
		agent: "sisyphus",
		cwd: process.cwd(),
	});
	const second = await manager.launch({
		description: "dup",
		prompt: "same-prompt",
		agent: "sisyphus",
		cwd: process.cwd(),
	});
	assert.ok(first.task);
	assert.ok(!second.task);
	assert.match(second.error ?? "", /duplicate/);
});

test("background manager injects guardrails into prompt", async () => {
	const { manager } = setupBackground();
	await manager.getGuardrails().append("sisyphus", "Always run tests", "warning");
	const launched = await manager.launch({
		description: "guarded",
		prompt: "Implement feature",
		agent: "sisyphus",
		cwd: process.cwd(),
	});
	assert.ok(launched.task);
	assert.match(launched.task?.prompt ?? "", /# Guardrails/);
	assert.match(launched.task?.prompt ?? "", /Always run tests/);
});

test("background manager records kernel handoff after completion", async () => {
	const { manager } = setupBackground();
	const launched = await manager.launch({
		description: "kernel",
		prompt: "kernel path",
		agent: "oracle",
		cwd: process.cwd(),
	});
	assert.ok(launched.task);
	await waitFor(() => manager.getTask(launched.task!.id)?.status === "completed");
	const handoff = manager.getKernel().getHandoff(launched.task!.id);
	assert.ok(handoff);
	assert.match(handoff?.freshnessHash ?? "", /^[a-f0-9]{64}$/);
});

test("background manager can cancel running task", async () => {
	const { manager } = setupBackground({ spawnDelayMs: 800 });
	const launched = await manager.launch({
		description: "cancel me",
		prompt: "slow task",
		agent: "sisyphus",
		cwd: process.cwd(),
	});
	assert.ok(launched.task);
	await waitFor(() => manager.getTask(launched.task!.id)?.status === "running");
	const cancelled = manager.cancel(launched.task!.id);
	assert.equal(cancelled, true);
	await waitFor(() => manager.getTask(launched.task!.id)?.status === "cancelled");
});

test("background manager snapshot reflects active tasks", async () => {
	const { manager } = setupBackground({ spawnDelayMs: 500 });
	await manager.launch({ description: "snap", prompt: "a", agent: "sisyphus", cwd: process.cwd() });
	const snapshot = manager.snapshot();
	assert.equal(snapshot.maxConcurrency, 2);
	assert.ok(snapshot.running >= 0);
	assert.ok(snapshot.kernel.workItems >= 1);
});
