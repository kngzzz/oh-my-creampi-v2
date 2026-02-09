import test from "node:test";
import assert from "node:assert/strict";

import { HarnessKernel } from "../lib/primitives/kernel";

test("kernel registerWorkItem starts in pending state", () => {
	const kernel = new HarnessKernel();
	const item = kernel.registerWorkItem({ id: "w1", title: "Title", goal: "Goal" });
	assert.equal(item.state, "pending");
	assert.equal(kernel.getWorkItem("w1")?.state, "pending");
});

test("kernel acquireLease transitions pending -> leased", () => {
	const kernel = new HarnessKernel();
	kernel.registerWorkItem({ id: "w1", title: "Title", goal: "Goal" });
	const lease = kernel.acquireLease("w1", "sisyphus");
	assert.equal(lease.ok, true);
	assert.equal(kernel.getWorkItem("w1")?.state, "leased");
});

test("kernel blocks lease acquisition by different holder", () => {
	const kernel = new HarnessKernel();
	kernel.registerWorkItem({ id: "w1", title: "Title", goal: "Goal" });
	kernel.acquireLease("w1", "a1");
	const blocked = kernel.acquireLease("w1", "a2");
	assert.equal(blocked.ok, false);
	assert.match(blocked.error ?? "", /lease held by/);
});

test("kernel rejects invalid transitions", () => {
	const kernel = new HarnessKernel();
	kernel.registerWorkItem({ id: "w1", title: "Title", goal: "Goal" });
	const invalid = kernel.transitionWorkItem("w1", "completed");
	assert.equal(invalid.ok, false);
	assert.match(invalid.error ?? "", /invalid transition/);
});

test("kernel completeWithHandoff succeeds with passing blocking evals", () => {
	const kernel = new HarnessKernel();
	kernel.registerWorkItem({ id: "w1", title: "Title", goal: "Goal" });
	kernel.acquireLease("w1", "oracle");
	kernel.transitionWorkItem("w1", "running", { agent: "oracle" });
	const result = kernel.completeWithHandoff("w1", {
		fromAgent: "oracle",
		summary: "done",
		nextAction: "none",
		evals: [{ name: "exit_code", passed: true, blocking: true }],
	});
	assert.equal(result.ok, true);
	assert.equal(kernel.getWorkItem("w1")?.state, "completed");
	assert.ok(kernel.getHandoff("w1")?.freshnessHash);
});

test("kernel completeWithHandoff fails when blocking eval fails", () => {
	const kernel = new HarnessKernel();
	kernel.registerWorkItem({ id: "w1", title: "Title", goal: "Goal" });
	kernel.acquireLease("w1", "oracle");
	kernel.transitionWorkItem("w1", "running", { agent: "oracle" });
	const result = kernel.completeWithHandoff("w1", {
		fromAgent: "oracle",
		summary: "failed",
		nextAction: "retry",
		evals: [{ name: "exit_code", passed: false, blocking: true }],
	});
	assert.equal(result.ok, false);
	assert.equal(result.state, "failed");
	assert.equal(kernel.getWorkItem("w1")?.state, "failed");
});

test("kernel cancelWorkItem transitions to cancelled", () => {
	const kernel = new HarnessKernel();
	kernel.registerWorkItem({ id: "w1", title: "Title", goal: "Goal" });
	kernel.acquireLease("w1", "sisyphus");
	const cancelled = kernel.cancelWorkItem("w1", "sisyphus");
	assert.equal(cancelled.ok, true);
	assert.equal(kernel.getWorkItem("w1")?.state, "cancelled");
});

test("kernel recordPolicyDenied emits trace event", () => {
	const kernel = new HarnessKernel();
	kernel.registerWorkItem({ id: "w1", runId: "run-1", title: "Title", goal: "Goal" });
	kernel.recordPolicyDenied({
		workItemId: "w1",
		runId: "run-1",
		agent: "oracle",
		violations: ["tool denied"],
	});
	const trace = kernel.getRecentTrace({ workItemId: "w1", limit: 10 });
	assert.ok(trace.some((event) => event.type === "policy.denied"));
});
