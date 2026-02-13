import { mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";

import type { ExtensionAPI, ExtensionExecResult, WorktreeConfig, WorktreeInfo } from "./types";

export type ExecFn = NonNullable<ExtensionAPI["exec"]>;

export type WorktreeCreateOptions = {
	exec: ExecFn;
	cwd: string;
	taskId: string;
	config: WorktreeConfig;
};

type GitOptions = {
	cwd: string;
	timeout?: number;
};

function cleanStdout(text: string): string {
	return text.trim();
}

async function git(exec: ExecFn, args: string[], opts: GitOptions): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
	try {
		const result: ExtensionExecResult = await exec("git", args, { cwd: opts.cwd, timeout: opts.timeout });
		return {
			ok: result.code === 0,
			stdout: cleanStdout(result.stdout),
			stderr: cleanStdout(result.stderr),
			code: result.code,
		};
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			stdout: "",
			stderr: message,
			code: -1,
		};
	}
}

export async function detectGitRoot(exec: ExecFn, cwd: string): Promise<string | null> {
	const result = await git(exec, ["rev-parse", "--show-toplevel"], { cwd });
	return result.ok && result.stdout ? result.stdout : null;
}

export async function getGitHead(exec: ExecFn, cwd: string): Promise<string | null> {
	const result = await git(exec, ["rev-parse", "HEAD"], { cwd });
	return result.ok && result.stdout ? result.stdout : null;
}

export async function createWorktree(opts: WorktreeCreateOptions): Promise<{ info?: WorktreeInfo; error?: string }> {
	const { exec, cwd, taskId, config } = opts;
	const gitRoot = await detectGitRoot(exec, cwd);
	if (!gitRoot) return { error: "not_a_git_repo" };

	const head = await getGitHead(exec, cwd);
	const worktreePath = path.join(gitRoot, config.dir, taskId);
	const branch = `${config.branchPrefix}${taskId}`;

	await git(exec, ["worktree", "remove", "--force", worktreePath], { cwd: gitRoot });
	await git(exec, ["branch", "-D", branch], { cwd: gitRoot });
	try {
		rmSync(worktreePath, { recursive: true, force: true });
	} catch (error) {
		void error;
	}

	mkdirSync(path.dirname(worktreePath), { recursive: true });

	const addArgs = ["worktree", "add", "-b", branch, worktreePath];
	if (head) addArgs.push(head);

	const added = await git(exec, addArgs, { cwd: gitRoot });
	if (!added.ok) {
		return { error: added.stderr || added.stdout || `git_worktree_add_failed:${added.code}` };
	}

	return {
		info: {
			taskId,
			path: worktreePath,
			branch,
			gitRoot,
			baseBranch: head ?? "HEAD",
		},
	};
}

export async function removeWorktree(
	exec: ExecFn,
	info: WorktreeInfo,
	opts?: { cwd?: string; deleteBranch?: boolean; timeout?: number },
): Promise<{ ok: boolean; error?: string }> {
	const cwd = opts?.cwd ?? info.gitRoot;
	const timeout = opts?.timeout;

	const removed = await git(exec, ["worktree", "remove", "--force", info.path], { cwd, timeout });
	try {
		rmSync(info.path, { recursive: true, force: true });
	} catch (error) {
		void error;
	}

	if (!removed.ok) {
		return { ok: false, error: removed.stderr || removed.stdout || `git_worktree_remove_failed:${removed.code}` };
	}

	if (opts?.deleteBranch) {
		const deleted = await git(exec, ["branch", "-D", info.branch], { cwd, timeout });
		if (!deleted.ok) {
			return { ok: false, error: deleted.stderr || deleted.stdout || `git_branch_delete_failed:${deleted.code}` };
		}
	}

	return { ok: true };
}
