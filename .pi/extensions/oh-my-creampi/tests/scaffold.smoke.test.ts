import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import ohMyCreamPi from "../index";
import { MockExtensionApi, makeContext, makeTempDir } from "./helpers";

function setup(root: string): { api: MockExtensionApi; ctx: ReturnType<typeof makeContext> } {
	const api = new MockExtensionApi(async () => ({ code: 0, stdout: "ok", stderr: "" }));
	ohMyCreamPi(api);
	return { api, ctx: makeContext(root) };
}

test("creampi-init creates expected workspace structure", async () => {
	const root = makeTempDir();
	const { api, ctx } = setup(root);

	await api.commands.get("creampi-init")!.handler("", ctx);

	assert.equal(fs.existsSync(path.join(root, ".pi", "loops")), true);
	assert.equal(fs.existsSync(path.join(root, ".pi", "agents")), true);
	assert.equal(fs.existsSync(path.join(root, ".creampi", "guardrails")), true);
	assert.equal(fs.existsSync(path.join(root, ".creampi", "checkpoints")), true);
	assert.equal(fs.existsSync(path.join(root, ".pi", "kernel-awareness.md")), true);
	assert.equal(fs.existsSync(path.join(root, ".pi", "agents", "default.md")), true);
});

test("creampi-init does not overwrite existing awareness or agent files", async () => {
	const root = makeTempDir();
	const awarenessPath = path.join(root, ".pi", "kernel-awareness.md");
	const customAgentPath = path.join(root, ".pi", "agents", "custom.md");
	fs.mkdirSync(path.dirname(customAgentPath), { recursive: true });
	fs.writeFileSync(awarenessPath, "# Custom awareness", "utf8");
	fs.writeFileSync(customAgentPath, "---\nname: custom\ndescription: custom\nbackend: pi\n---\nCustom", "utf8");

	const { api, ctx } = setup(root);
	await api.commands.get("creampi-init")!.handler("", ctx);

	assert.equal(fs.readFileSync(awarenessPath, "utf8"), "# Custom awareness");
	assert.equal(fs.existsSync(customAgentPath), true);
	assert.equal(fs.existsSync(path.join(root, ".pi", "agents", "default.md")), false);
});
