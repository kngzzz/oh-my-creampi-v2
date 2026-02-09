import test from "node:test";
import assert from "node:assert/strict";

import { evaluatePolicy, type PolicyConfig } from "../lib/primitives/policy";

test("policy allows when no config provided", () => {
	const decision = evaluatePolicy(undefined, { kind: "background_task", prompt: "hello" });
	assert.equal(decision.allowed, true);
	assert.deepEqual(decision.violations, []);
});

test("policy blocks denied agent", () => {
	const config: PolicyConfig = { backgroundTask: { deniedAgents: ["oracle"] } };
	const decision = evaluatePolicy(config, {
		kind: "background_task",
		agent: "oracle",
		prompt: "analyze",
	});
	assert.equal(decision.allowed, false);
	assert.match(decision.violations.join(";"), /agent denied/);
});

test("policy blocks agents outside allow list", () => {
	const config: PolicyConfig = { backgroundTask: { allowedAgents: ["sisyphus"] } };
	const decision = evaluatePolicy(config, {
		kind: "background_task",
		agent: "prometheus",
		prompt: "plan this",
	});
	assert.equal(decision.allowed, false);
	assert.match(decision.violations.join(";"), /agent not allowed/);
});

test("policy blocks denied tool", () => {
	const config: PolicyConfig = { backgroundTask: { deniedTools: ["bash"] } };
	const decision = evaluatePolicy(config, {
		kind: "background_task",
		agent: "sisyphus",
		prompt: "task",
		requestedTools: ["Read", "Bash"],
	});
	assert.equal(decision.allowed, false);
	assert.match(decision.violations.join(";"), /tool denied: bash/);
});

test("policy blocks prompt above max length", () => {
	const config: PolicyConfig = { backgroundTask: { maxPromptChars: 8 } };
	const decision = evaluatePolicy(config, {
		kind: "background_task",
		prompt: "this prompt is long",
	});
	assert.equal(decision.allowed, false);
	assert.match(decision.violations.join(";"), /prompt too long/);
});

test("policy blocks denied prompt pattern", () => {
	const config: PolicyConfig = { backgroundTask: { deniedPatterns: ["rm -rf"] } };
	const decision = evaluatePolicy(config, {
		kind: "background_task",
		prompt: "please run rm -rf / in shell",
	});
	assert.equal(decision.allowed, false);
	assert.match(decision.violations.join(";"), /denied pattern/);
});

test("loop trigger policy can require trigger source", () => {
	const config: PolicyConfig = { loopTrigger: { requireTriggerSource: true } };
	const decision = evaluatePolicy(config, {
		kind: "loop_trigger",
		agent: "oracle",
		prompt: "run loop",
	});
	assert.equal(decision.allowed, false);
	assert.match(decision.violations.join(";"), /trigger source required/);
});

test("policy aggregates multiple violations", () => {
	const config: PolicyConfig = {
		backgroundTask: {
			allowedAgents: ["sisyphus"],
			deniedTools: ["bash"],
			maxPromptChars: 5,
		},
	};
	const decision = evaluatePolicy(config, {
		kind: "background_task",
		agent: "oracle",
		prompt: "too long",
		requestedTools: ["bash"],
	});
	assert.equal(decision.allowed, false);
	assert.ok(decision.violations.length >= 3);
});
