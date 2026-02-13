import test from "node:test";
import assert from "node:assert/strict";

import ohMyCreamPi from "../index";
import { makeContext, makeTempDir, MockExtensionApi, writeLoopFile } from "./helpers";

function setupProjectRoot(): string {
	const root = makeTempDir();
	writeLoopFile(
		root,
		"demo.md",
		`---
name: demo-loop
version: 1
description: demo
trigger:
  type: manual
agent: oracle
backend: pi
timeout: 60
max_concurrent: 1
cooldown: 0
max_retries: 0
should_run: 1 == 2
eval:
  type: exit_code
  pass_condition: 0
  blocking: true
inputs:
  market: ETH
---
Analyze {market}
`,
	);
	return root;
}

function setupExtension(root: string): { api: MockExtensionApi; ctx: ReturnType<typeof makeContext> } {
	const api = new MockExtensionApi(async () => ({ code: 0, stdout: "ok", stderr: "" }));
	ohMyCreamPi(api);
	return { api, ctx: makeContext(root) };
}

test("index registers 8 tools", () => {
	const root = setupProjectRoot();
	const { api } = setupExtension(root);
	const expected = [
		"background_task",
		"background_status",
		"background_cancel",
		"loop_trigger",
		"loop_status",
		"self_query",
		"signal_loop_success",
		"guardrail_add",
	].sort();
	assert.deepEqual([...api.tools.keys()].sort(), expected);
});

test("index registers 5 commands", () => {
	const root = setupProjectRoot();
	const { api } = setupExtension(root);
	assert.deepEqual([...api.commands.keys()].sort(), ["creampi", "creampi-health", "creampi-init", "creampi-loop", "creampi-loops"]);
});

test("background_task tool smoke", async () => {
	const root = setupProjectRoot();
	const { api, ctx } = setupExtension(root);
	const tool = api.tools.get("background_task");
	assert.ok(tool);
	const result = await tool!.execute(
		"1",
		{ prompt: "hello" },
		undefined,
		undefined,
		ctx,
	);
	assert.match(result.content[0]?.text ?? "", /description and prompt are required/i);
});

test("background_status tool smoke", async () => {
	const root = setupProjectRoot();
	const { api, ctx } = setupExtension(root);
	const status = await api.tools.get("background_status")!.execute(
		"1",
		{ taskId: "task_missing" },
		undefined,
		undefined,
		ctx,
	);
	assert.match(status.content[0]?.text ?? "", /not found/i);
});

test("background_cancel tool smoke", async () => {
	const root = setupProjectRoot();
	const { api, ctx } = setupExtension(root);
	const cancel = await api.tools.get("background_cancel")!.execute(
		"1",
		{ taskId: "task_missing" },
		undefined,
		undefined,
		ctx,
	);
	assert.match(cancel.content[0]?.text ?? "", /unable to cancel/i);
});

test("loop_trigger tool smoke", async () => {
	const root = setupProjectRoot();
	const { api, ctx } = setupExtension(root);
	const result = await api.tools.get("loop_trigger")!.execute(
		"1",
		{ loopName: "demo-loop", triggerSource: "manual" },
		undefined,
		undefined,
		ctx,
	);
	assert.match(result.content[0]?.text ?? "", /Loop: demo-loop/);
});

test("loop_status tool smoke", async () => {
	const root = setupProjectRoot();
	const { api, ctx } = setupExtension(root);
	await api.tools.get("loop_trigger")!.execute("1", { loopName: "demo-loop", triggerSource: "manual" }, undefined, undefined, ctx);
	const result = await api.tools.get("loop_status")!.execute("2", {}, undefined, undefined, ctx);
	assert.match(result.content[0]?.text ?? "", /Loops/);
});

test("guardrail_add tool smoke", async () => {
	const root = setupProjectRoot();
	const { api, ctx } = setupExtension(root);
	const result = await api.tools.get("guardrail_add")!.execute(
		"1",
		{ domain: "code", lesson: "verify with tests", severity: "warning" },
		undefined,
		undefined,
		ctx,
	);
	assert.match(result.content[0]?.text ?? "", /guardrail added/i);
});

test("self_query tool smoke", async () => {
	const root = setupProjectRoot();
	const { api, ctx } = setupExtension(root);
	const result = await api.tools.get("self_query")!.execute(
		"1",
		{},
		undefined,
		undefined,
		ctx,
	);
	assert.match(result.content[0]?.text ?? "", /prompt is required/i);
});

test("signal_loop_success tool smoke", async () => {
	const root = setupProjectRoot();
	const { api, ctx } = setupExtension(root);
	const result = await api.tools.get("signal_loop_success")!.execute(
		"1",
		{},
		undefined,
		undefined,
		ctx,
	);
	assert.match(result.content[0]?.text ?? "", /No active temporal loop/i);
});

test("command smoke: creampi, creampi-loops, creampi-health", async () => {
	const root = setupProjectRoot();
	const { api, ctx } = setupExtension(root);
	await api.commands.get("creampi-init")!.handler("", ctx);
	await api.commands.get("creampi")!.handler("", ctx);
	await api.commands.get("creampi-loop")!.handler("", ctx);
	await api.commands.get("creampi-loops")!.handler("", ctx);
	await api.commands.get("creampi-health")!.handler("", ctx);
	assert.ok(true);
});
