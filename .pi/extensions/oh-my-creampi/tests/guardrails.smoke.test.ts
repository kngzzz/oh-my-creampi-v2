import test from "node:test";
import assert from "node:assert/strict";

import { GuardrailMemory } from "../lib/primitives/guardrails";
import { makeTempDir } from "./helpers";

test("guardrails append and list entries", async () => {
	const memory = new GuardrailMemory(makeTempDir());
	await memory.append("build", "Run tests before commit", "warning");
	const entries = await memory.list("build", 10);
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.lesson, "Run tests before commit");
	assert.equal(entries[0]?.severity, "warning");
});

test("guardrails renderForPrompt includes heading and lessons", async () => {
	const memory = new GuardrailMemory(makeTempDir());
	await memory.append("build", "Never skip lint", "critical");
	const rendered = await memory.renderForPrompt("build");
	assert.ok(rendered);
	assert.match(rendered ?? "", /# Guardrails/);
	assert.match(rendered ?? "", /Never skip lint/);
});

test("guardrails countByDomain reports counts", async () => {
	const memory = new GuardrailMemory(makeTempDir());
	await memory.append("build", "rule-a", "info");
	await memory.append("build", "rule-b", "warning");
	await memory.append("release", "rule-c", "critical");
	const counts = await memory.countByDomain();
	assert.equal(counts.build, 2);
	assert.equal(counts.release, 1);
});

test("guardrails list returns empty for unknown domain", async () => {
	const memory = new GuardrailMemory(makeTempDir());
	const entries = await memory.list("missing");
	assert.deepEqual(entries, []);
});

test("guardrails normalizes domain names", async () => {
	const memory = new GuardrailMemory(makeTempDir());
	await memory.append("Build Domain", "normalize me", "info");
	const entries = await memory.list("build-domain", 5);
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.domain, "build-domain");
});
