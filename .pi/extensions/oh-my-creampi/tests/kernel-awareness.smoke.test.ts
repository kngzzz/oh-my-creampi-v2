import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { composeKernelPrompt, readKernelAwareness } from "../lib/kernel-awareness";

describe("kernel awareness", () => {
	let tempDir = "";

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oh-my-creampi-kernel-awareness-"));
	});

	afterEach(() => {
		if (tempDir) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("readKernelAwareness returns available:true when file exists", async () => {
		const piDir = path.join(tempDir, ".pi");
		fs.mkdirSync(piDir, { recursive: true });
		fs.writeFileSync(path.join(piDir, "kernel-awareness.md"), "\nStay inside scope.\n");

		const awareness = await readKernelAwareness(tempDir);
		assert.deepEqual(awareness, {
			raw: "Stay inside scope.",
			available: true,
		});
	});

	it("readKernelAwareness returns available:false when file missing", async () => {
		const awareness = await readKernelAwareness(tempDir);
		assert.deepEqual(awareness, { raw: "", available: false });
	});

	it("readKernelAwareness returns available:false when file is empty", async () => {
		const piDir = path.join(tempDir, ".pi");
		fs.mkdirSync(piDir, { recursive: true });
		fs.writeFileSync(path.join(piDir, "kernel-awareness.md"), "   \n\t");

		const awareness = await readKernelAwareness(tempDir);
		assert.deepEqual(awareness, { raw: "", available: false });
	});

	it("composeKernelPrompt includes all sections when present", () => {
		const prompt = composeKernelPrompt({
			kernelAwareness: { raw: "Keep plans concise.", available: true },
			guardrails: "Run tests before shipping.",
			prompt: "Implement feature X.",
		});

		assert.equal(
			prompt,
			[
				"## Kernel Awareness\nKeep plans concise.",
				"## Guardrails (lessons from past runs)\nRun tests before shipping.",
				"---",
				"Implement feature X.",
			].join("\n\n"),
		);
	});

	it("composeKernelPrompt omits awareness when not available", () => {
		const prompt = composeKernelPrompt({
			kernelAwareness: { raw: "Should be ignored", available: false },
			guardrails: "Keep diffs focused.",
			prompt: "Fix bug Y.",
		});

		assert.equal(prompt.includes("## Kernel Awareness"), false);
		assert.equal(prompt.includes("## Guardrails (lessons from past runs)"), true);
	});

	it("composeKernelPrompt omits guardrails when empty", () => {
		const prompt = composeKernelPrompt({
			kernelAwareness: { raw: "Use stable APIs.", available: true },
			guardrails: "   ",
			prompt: "Add logging.",
		});

		assert.equal(prompt.includes("## Guardrails (lessons from past runs)"), false);
		assert.equal(prompt.includes("## Kernel Awareness"), true);
	});

	it("composeKernelPrompt works with prompt only", () => {
		const prompt = composeKernelPrompt({ prompt: "Do the task." });
		assert.equal(prompt, ["---", "Do the task."].join("\n\n"));
	});
});
