import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TemporalLoopEngine } from "../lib/temporal-loop";

function makeMockDeps() {
	const messages: string[] = [];
	const entries: Array<{ type: string; data: unknown }> = [];

	return {
		deps: {
			sendMessage: (msg: string) => messages.push(msg),
			appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
		},
		messages,
		entries,
	};
}

describe("TemporalLoopEngine", () => {
	it("starts inactive by default", () => {
		const { deps } = makeMockDeps();
		const engine = new TemporalLoopEngine(deps);

		assert.equal(engine.isActive(), false);
		assert.equal(engine.getIterations(), 0);
	});

	it("start activates with condition", () => {
		const { deps } = makeMockDeps();
		const engine = new TemporalLoopEngine(deps);

		engine.start("tests pass");

		assert.equal(engine.isActive(), true);
		assert.equal(engine.getCondition(), "tests pass");
	});

	it("signalSuccess completes loop", () => {
		const { deps } = makeMockDeps();
		const engine = new TemporalLoopEngine(deps);

		engine.start("all checks green");
		const result = engine.signalSuccess("done");

		assert.equal(engine.isActive(), false);
		assert.equal(result.isError, undefined);
	});

	it("signalSuccess without active loop returns error", () => {
		const { deps } = makeMockDeps();
		const engine = new TemporalLoopEngine(deps);

		const result = engine.signalSuccess();

		assert.equal(result.isError, true);
		assert.equal(result.content[0]?.text, "No active temporal loop to signal.");
	});

	it("stop deactivates loop", () => {
		const { deps } = makeMockDeps();
		const engine = new TemporalLoopEngine(deps);

		engine.start("ship feature");
		engine.stop();

		assert.equal(engine.isActive(), false);
	});

	it("onAgentEnd increments iteration and sends message", () => {
		const { deps, messages } = makeMockDeps();
		const engine = new TemporalLoopEngine(deps);

		engine.start("ship feature");
		engine.onAgentEnd();

		assert.equal(engine.getIterations(), 1);
		assert.equal(messages.length, 1);
	});

	it("onAgentEnd does nothing when inactive", () => {
		const { deps, messages } = makeMockDeps();
		const engine = new TemporalLoopEngine(deps);

		engine.onAgentEnd();

		assert.equal(messages.length, 0);
	});

	it("auto-stops on three low-novelty iterations", () => {
		const { deps, messages } = makeMockDeps();
		const engine = new TemporalLoopEngine(deps);

		engine.start("ship feature");
		engine.onAgentEnd({ linesChanged: 1 });
		engine.onAgentEnd({ linesChanged: 2 });
		engine.onAgentEnd({ linesChanged: 0 });

		assert.equal(engine.isActive(), false);
		assert.match(messages[messages.length - 1] ?? "", /auto-stopped/i);
	});

	it("auto-stops on three stalled progress iterations", () => {
		const { deps, messages } = makeMockDeps();
		const engine = new TemporalLoopEngine(deps);

		engine.start("ship feature");
		engine.onAgentEnd({ progressHash: "a" });
		engine.onAgentEnd({ progressHash: "a" });
		engine.onAgentEnd({ progressHash: "a" });
		engine.onAgentEnd({ progressHash: "a" });

		assert.equal(engine.isActive(), false);
		assert.match(messages[messages.length - 1] ?? "", /maintenance_spiral/i);
	});

	it("onBeforeCompact injects instructions", () => {
		const { deps } = makeMockDeps();
		const engine = new TemporalLoopEngine(deps);
		const event: { customInstructions?: string } = {};

		engine.start("tests pass");
		engine.onBeforeCompact(event);

		assert.match(event.customInstructions ?? "", /signal_loop_success/);
		assert.match(event.customInstructions ?? "", /tests pass/);
	});

	it("restoreFromEntries replays state", () => {
		const { deps } = makeMockDeps();
		const engine = new TemporalLoopEngine(deps);

		engine.restoreFromEntries([
			{
				type: "custom",
				customType: "oh-my-creampi.temporal-loop",
				data: { event: "temporal-loop.started", condition: "done", startedAt: 1 },
			},
			{
				type: "custom",
				customType: "oh-my-creampi.temporal-loop",
				data: { event: "temporal-loop.iteration", iteration: 1 },
			},
			{
				type: "custom",
				customType: "oh-my-creampi.temporal-loop",
				data: { event: "temporal-loop.iteration", iteration: 2 },
			},
		]);

		assert.equal(engine.isActive(), true);
		assert.equal(engine.getIterations(), 2);
	});
});
