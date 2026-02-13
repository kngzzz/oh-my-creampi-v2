import * as fs from "node:fs";
import * as path from "node:path";

export const KERNEL_AWARENESS_TEMPLATE = [
	"# How to Set Yourself Up for Success",
	"",
	"You are an agent running inside an orchestration kernel.",
	"",
	"## Before You Start",
	"- Read the task and define done criteria.",
	"- Check guardrails and avoid repeated mistakes.",
	"- Plan around your available budget.",
	"",
	"## While You Work",
	"- Stay focused and avoid scope creep.",
	"- Verify outputs against expected criteria.",
	"- If blocked, report concrete blockers.",
	"",
	"## When You Finish",
	"- Summarize what changed and what remains.",
	"- Record lessons that should become guardrails.",
	"- Be explicit about quality and test status.",
].join("\n");

export const DEFAULT_AGENT_TEMPLATE = [
	"---",
	"name: default",
	"description: Default project agent profile",
	"backend: pi",
	"tools: [Read, Write, Edit, Bash, Grep, Glob, Task]",
	"---",
	"You are the default project coding agent.",
	"Read the codebase before editing and verify with tests.",
].join("\n");

export async function initializeWorkspace(root: string): Promise<void> {
	const dirs = [
		path.join(root, ".pi", "loops"),
		path.join(root, ".pi", "agents"),
		path.join(root, ".creampi", "guardrails"),
		path.join(root, ".creampi", "checkpoints"),
	];
	await Promise.all(dirs.map((dir) => fs.promises.mkdir(dir, { recursive: true })));

	const awarenessPath = path.join(root, ".pi", "kernel-awareness.md");
	if (!fs.existsSync(awarenessPath)) {
		await fs.promises.writeFile(awarenessPath, KERNEL_AWARENESS_TEMPLATE, "utf8");
	}

	const agentsDir = path.join(root, ".pi", "agents");
	const existingAgents = await fs.promises.readdir(agentsDir).catch(() => [] as string[]);
	const hasAgentMarkdown = existingAgents.some((name) => name.toLowerCase().endsWith(".md"));
	if (!hasAgentMarkdown) {
		await fs.promises.writeFile(path.join(agentsDir, "default.md"), DEFAULT_AGENT_TEMPLATE, "utf8");
	}
}
