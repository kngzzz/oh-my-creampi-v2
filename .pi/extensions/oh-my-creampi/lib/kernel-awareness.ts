import * as path from "node:path";

import type { KernelAwareness } from "./types";
import { readTextIfExists } from "./util";

export async function readKernelAwareness(projectRoot: string): Promise<KernelAwareness> {
	const filePath = path.join(projectRoot, ".pi", "kernel-awareness.md");
	const raw = await readTextIfExists(filePath);
	const trimmed = raw?.trim() ?? "";

	if (!trimmed) {
		return {
			raw: "",
			available: false,
		};
	}

	return {
		raw: trimmed,
		available: true,
	};
}

type ComposeKernelPromptInput = {
	kernelAwareness?: KernelAwareness;
	guardrails?: string | null;
	prompt: string;
};

export function composeKernelPrompt(parts: ComposeKernelPromptInput): string {
	const sections: string[] = [];

	const awareness = parts.kernelAwareness;
	const awarenessBody = awareness?.raw?.trim() ?? "";
	if (awareness?.available && awarenessBody) {
		sections.push(`## Kernel Awareness\n${awarenessBody}`);
	}

	const guardrailsBody = parts.guardrails?.trim() ?? "";
	if (guardrailsBody) {
		sections.push(`## Guardrails (lessons from past runs)\n${guardrailsBody}`);
	}

	sections.push("---");
	sections.push(parts.prompt);

	return sections.filter((section) => section.trim().length > 0).join("\n\n");
}
