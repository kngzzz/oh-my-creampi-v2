import test from "node:test";
import assert from "node:assert/strict";

import { AdmissionController } from "../lib/primitives/admission";

test("admission allows first task", () => {
	const admission = new AdmissionController(1);
	const decision = admission.admit("task-1");
	assert.equal(decision.allowed, true);
	if (decision.allowed) {
		assert.equal(decision.grant.taskId, "task-1");
	}
});

test("admission blocks when at max concurrency", () => {
	const admission = new AdmissionController(1);
	admission.admit("task-1");
	const blocked = admission.admit("task-2");
	assert.equal(blocked.allowed, false);
	if (!blocked.allowed) {
		assert.match(blocked.reason, /over capacity/);
	}
});

test("admission release by task id frees slot", () => {
	const admission = new AdmissionController(1);
	admission.admit("task-1");
	admission.release("task-1");
	const allowed = admission.admit("task-2");
	assert.equal(allowed.allowed, true);
});

test("admission release by grant id frees slot", () => {
	const admission = new AdmissionController(1);
	const first = admission.admit("task-1");
	assert.equal(first.allowed, true);
	if (first.allowed) {
		admission.release(first.grant.grantId);
	}
	const second = admission.admit("task-2");
	assert.equal(second.allowed, true);
});

test("admission returns same grant for repeated same task", () => {
	const admission = new AdmissionController(2);
	const first = admission.admit("task-1");
	const second = admission.admit("task-1");
	assert.equal(first.allowed, true);
	assert.equal(second.allowed, true);
	if (first.allowed && second.allowed) {
		assert.equal(first.grant.grantId, second.grant.grantId);
	}
});
