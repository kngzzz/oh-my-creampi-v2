import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";

import { createWorktree, detectGitRoot, removeWorktree } from "../lib/worktree";
import type { ExecFn } from "../lib/worktree";
import type { ExtensionExecResult, WorktreeConfig, WorktreeInfo } from "../lib/types";

const config: WorktreeConfig = {
	enabled: true,
	dir: ".creampi/worktrees",
	branchPrefix: "bg_",
	cleanup: "on-finish",
};

function mockExec(fn: (args: string[], options: { cwd: string; timeout?: number }) => ExtensionExecResult): ExecFn {
	return async (_bin, args, options) => fn(args, options);
}

describe("worktree smoke", () => {
	it("detectGitRoot returns path when git succeeds", async () => {
		const exec = mockExec((args) => {
			assert.deepEqual(args, ["rev-parse", "--show-toplevel"]);
			return { code: 0, stdout: "/tmp/repo\n", stderr: "" };
		});
		const root = await detectGitRoot(exec, "/tmp/repo");
		assert.equal(root, "/tmp/repo");
	});

	it("detectGitRoot returns null when git fails", async () => {
		const exec = mockExec(() => ({ code: 1, stdout: "", stderr: "fatal: not a git repository" }));
		const root = await detectGitRoot(exec, "/tmp/nope");
		assert.equal(root, null);
	});

	it("createWorktree returns error when not a git repo", async () => {
		const exec = mockExec(() => ({ code: 1, stdout: "", stderr: "fatal: not a git repository" }));
		const result = await createWorktree({ exec, cwd: "/tmp/nope", taskId: "task-x", config });
		assert.equal(result.error, "not_a_git_repo");
		assert.equal(result.info, undefined);
	});

	it("createWorktree returns info on success", async () => {
		const gitRoot = path.join(process.cwd(), ".tmp-worktree-smoke", `repo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		mkdirSync(gitRoot, { recursive: true });
		const calls: string[][] = [];
		const exec = mockExec((args) => {
			calls.push(args);
			if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 0, stdout: `${gitRoot}\n`, stderr: "" };
			if (args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: "abc123\n", stderr: "" };
			if (args[0] === "worktree" && args[1] === "add") return { code: 0, stdout: "ok\n", stderr: "" };
			return { code: 1, stdout: "", stderr: "ignore" };
		});

		const result = await createWorktree({ exec, cwd: gitRoot, taskId: "task-1", config });
		const expectedPath = path.join(gitRoot, ".creampi/worktrees", "task-1");
		assert.equal(result.error, undefined);
		assert.deepEqual(result.info, {
			taskId: "task-1",
			path: expectedPath,
			branch: "bg_task-1",
			gitRoot,
			baseBranch: "abc123",
		});
		assert.equal(calls.some((entry) => entry.join(" ") === `worktree add -b bg_task-1 ${expectedPath} abc123`), true);
		rmSync(path.join(process.cwd(), ".tmp-worktree-smoke"), { recursive: true, force: true });
	});

	it("removeWorktree returns ok:true on success", async () => {
		const exec = mockExec((args) => {
			if (args[0] === "worktree") return { code: 0, stdout: "", stderr: "" };
			if (args[0] === "branch") return { code: 0, stdout: "", stderr: "" };
			return { code: 1, stdout: "", stderr: "unexpected" };
		});
		const info: WorktreeInfo = {
			taskId: "task-2",
			path: path.join(process.cwd(), ".tmp-worktree-smoke", "task-2"),
			branch: "bg_task-2",
			gitRoot: process.cwd(),
			baseBranch: "abc123",
		};
		const result = await removeWorktree(exec, info, { deleteBranch: true });
		assert.deepEqual(result, { ok: true });
	});

	it("removeWorktree returns ok:false on failure", async () => {
		const exec = mockExec(() => ({ code: 1, stdout: "", stderr: "boom" }));
		const info: WorktreeInfo = {
			taskId: "task-3",
			path: path.join(process.cwd(), ".tmp-worktree-smoke", "task-3"),
			branch: "bg_task-3",
			gitRoot: process.cwd(),
			baseBranch: "abc123",
		};
		const result = await removeWorktree(exec, info);
		assert.equal(result.ok, false);
		assert.equal(result.error, "boom");
	});
});
