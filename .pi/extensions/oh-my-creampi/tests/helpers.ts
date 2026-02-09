import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { AgentRunRequest, ExtensionAPI, RegisteredCommand, RegisteredTool, ToolExecuteContext } from "../lib/types";

export function makeTempDir(prefix = "creampi-v2-test-"): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeLoopFile(projectRoot: string, fileName: string, content: string): string {
	const loopsDir = path.join(projectRoot, ".pi", "loops");
	fs.mkdirSync(loopsDir, { recursive: true });
	const filePath = path.join(loopsDir, fileName);
	fs.writeFileSync(filePath, content, "utf8");
	return filePath;
}

export function writeAgentFile(projectRoot: string, fileName: string, content: string): string {
	const agentsDir = path.join(projectRoot, ".pi", "agents");
	fs.mkdirSync(agentsDir, { recursive: true });
	const filePath = path.join(agentsDir, fileName);
	fs.writeFileSync(filePath, content, "utf8");
	return filePath;
}

export function makeContext(cwd: string): ToolExecuteContext {
	return {
		cwd,
		hasUI: false,
	};
}

export class MockExtensionApi implements ExtensionAPI {
	public readonly tools = new Map<string, RegisteredTool<Record<string, unknown>>>();
	public readonly commands = new Map<string, RegisteredCommand>();
	public readonly handlers = new Map<string, Array<(event: unknown, ctx: ToolExecuteContext) => unknown>>();

	constructor(
		private readonly execImpl?: (bin: string, args: string[], options: { cwd: string; timeout?: number }) => Promise<{
			code: number;
			stdout: string;
			stderr: string;
		}>,
	) {}

	registerTool<TParams extends Record<string, unknown>>(tool: RegisteredTool<TParams>): void {
		this.tools.set(tool.name, tool as unknown as RegisteredTool<Record<string, unknown>>);
	}

	registerCommand(name: string, command: RegisteredCommand): void {
		this.commands.set(name, command);
	}

	exec(bin: string, args: string[], options: { cwd: string; timeout?: number }): Promise<{ code: number; stdout: string; stderr: string }> {
		if (this.execImpl) return this.execImpl(bin, args, options);
		return Promise.resolve({ code: 0, stdout: "ok", stderr: "" });
	}

	on(eventName: string, handler: (event: unknown, ctx: ToolExecuteContext) => unknown): void {
		const list = this.handlers.get(eventName) ?? [];
		list.push(handler);
		this.handlers.set(eventName, list);
	}
}

export async function waitFor(
	predicate: () => boolean,
	options?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
	const timeoutMs = options?.timeoutMs ?? 3_000;
	const intervalMs = options?.intervalMs ?? 25;
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`waitFor timeout after ${timeoutMs}ms`);
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
}

export function makeSpawnRunner(options?: { exitCode?: number; output?: string; delayMs?: number }) {
	const exitCode = options?.exitCode ?? 0;
	const output = options?.output ?? "ok";
	const delayMs = options?.delayMs ?? 0;

	return (request: AgentRunRequest) => {
		const script = [
			delayMs > 0 ? `setTimeout(() => {` : "",
			`process.stdout.write(${JSON.stringify(output)});`,
			`process.exit(${Math.max(0, Math.floor(exitCode))});`,
			delayMs > 0 ? `}, ${delayMs});` : "",
		].join("\n");
		const proc = spawn(process.execPath, ["-e", script], {
			cwd: request.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		proc.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		const done = new Promise<{
			exitCode: number;
			stdout: string;
			stderr: string;
			output: string;
			usage: { turns: number; input: number; output: number; cost: number };
			timedOut?: boolean;
		}>((resolve) => {
			proc.on("close", (code) => {
				resolve({
					exitCode: code ?? exitCode,
					stdout,
					stderr,
					output: stdout,
					usage: { turns: 1, input: 1, output: 1, cost: 0 },
				});
			});
		});

		return {
			proc,
			done,
		};
	};
}
