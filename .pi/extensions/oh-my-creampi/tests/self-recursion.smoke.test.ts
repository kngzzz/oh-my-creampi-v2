import test from "node:test";
import assert from "node:assert/strict";

import { AgentRegistry, getBuiltinAgentProfiles } from "../lib/agents";
import { SelfRecursionEngine } from "../lib/self-recursion";
import { makeSpawnRunner } from "./helpers";

test("self recursion returns result for valid agent", async () => {
	const engine = new SelfRecursionEngine({
		agents: new AgentRegistry(getBuiltinAgentProfiles()),
		spawnRunner: makeSpawnRunner({ output: "child-output", exitCode: 0 }),
		config: { maxDepth: 3 },
	});

	const response = await engine.query(
		{ prompt: "run child step", agent: "sisyphus", context: "do one focused task" },
		{ cwd: process.cwd() },
	);

	assert.equal(response.error, undefined);
	assert.equal(response.result?.exitCode, 0);
	assert.equal(response.result?.output, "child-output");
	assert.equal(response.result?.depth, 1);
});

test("self recursion rejects unknown agent", async () => {
	const engine = new SelfRecursionEngine({
		agents: new AgentRegistry(getBuiltinAgentProfiles()),
		spawnRunner: makeSpawnRunner({ output: "ignored", exitCode: 0 }),
	});

	const response = await engine.query(
		{ prompt: "run child step", agent: "missing-agent" },
		{ cwd: process.cwd() },
	);

	assert.match(response.error ?? "", /unknown agent profile/i);
	assert.equal(response.result, undefined);
});

test("self recursion enforces max depth", async () => {
	const previous = process.env.CREAMPI_SELF_DEPTH;
	process.env.CREAMPI_SELF_DEPTH = "2";

	try {
		const engine = new SelfRecursionEngine({
			agents: new AgentRegistry(getBuiltinAgentProfiles()),
			spawnRunner: makeSpawnRunner({ output: "ignored", exitCode: 0 }),
			config: { maxDepth: 2 },
		});

		const response = await engine.query(
			{ prompt: "run child step", agent: "sisyphus" },
			{ cwd: process.cwd() },
		);

		assert.match(response.error ?? "", /exceeds maxDepth/i);
		assert.equal(response.result, undefined);
	} finally {
		if (previous === undefined) delete process.env.CREAMPI_SELF_DEPTH;
		else process.env.CREAMPI_SELF_DEPTH = previous;
	}
});
