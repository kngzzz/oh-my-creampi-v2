import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { discoverProjectLoopDefinitions } from "../lib/loops/loader";
import { makeTempDir, writeLoopFile } from "./helpers";

const LOOP_MD = `---
name: demo-loop
version: 1
description: Demo loop
trigger:
  type: manual
agent: oracle
backend: pi
timeout: 90
max_concurrent: 1
cooldown: 10
max_retries: 2
eval:
  type: exit_code
  pass_condition: 0
  blocking: true
inputs:
  market: ETH
budget:
  maxTokens: 500
---
Analyze {market} and report.
`;

test("loop loader discovers markdown loop definitions", () => {
	const root = makeTempDir();
	writeLoopFile(root, "demo.md", LOOP_MD);
	const discovered = discoverProjectLoopDefinitions(root);
	assert.equal(discovered.loops.length, 1);
	assert.equal(discovered.loops[0]?.name, "demo-loop");
	assert.equal(discovered.loops[0]?.agent, "oracle");
});

test("loop loader applies defaults for missing fields", () => {
	const root = makeTempDir();
	writeLoopFile(
		root,
		"defaults.md",
		`---\nname: defaults\ntrigger:\n  type: manual\n---\nHello`,
	);
	const discovered = discoverProjectLoopDefinitions(root);
	const loop = discovered.loops[0];
	assert.equal(loop?.backend, "pi");
	assert.equal(loop?.timeoutSec, 120);
	assert.equal(loop?.eval.passCondition, 0);
});

test("loop loader warns and skips files missing frontmatter", () => {
	const root = makeTempDir();
	writeLoopFile(root, "broken.md", "No frontmatter");
	const discovered = discoverProjectLoopDefinitions(root);
	assert.equal(discovered.loops.length, 0);
	assert.ok(discovered.warnings.some((warning) => /missing frontmatter/.test(warning)));
});

test("loop loader warns on duplicate loop names", () => {
	const root = makeTempDir();
	writeLoopFile(root, "a.md", LOOP_MD);
	writeLoopFile(root, "b.md", LOOP_MD);
	const discovered = discoverProjectLoopDefinitions(root);
	assert.equal(discovered.loops.length, 1);
	assert.ok(discovered.warnings.some((warning) => /duplicate loop name/.test(warning)));
});

test("loop loader parses nested input fields", () => {
	const root = makeTempDir();
	writeLoopFile(
		root,
		"inputs.md",
		`---
name: inputs-loop
trigger:
  type: manual
inputs:
  timeframe: 4H
  pair: BTCUSD
---
Run.
`,
	);
	const discovered = discoverProjectLoopDefinitions(root);
	const loop = discovered.loops[0];
	assert.equal(loop?.inputs.timeframe, "4H");
	assert.equal(loop?.inputs.pair, "BTCUSD");
	assert.ok(fs.existsSync(path.join(root, ".pi", "loops", "inputs.md")));
});
