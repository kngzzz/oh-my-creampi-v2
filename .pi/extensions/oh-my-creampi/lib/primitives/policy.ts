export type PolicyRule = {
	allowedAgents?: string[];
	deniedAgents?: string[];
	deniedTools?: string[];
	maxPromptChars?: number;
	deniedPatterns?: string[];
	requireTriggerSource?: boolean;
};

export type PolicyConfig = {
	backgroundTask?: PolicyRule;
	loopTrigger?: PolicyRule;
};

export type PolicyRequest = {
	kind: "background_task" | "loop_trigger";
	agent?: string;
	prompt?: string;
	requestedTools?: string[];
	triggerSource?: string;
};

export type PolicyDecision = {
	allowed: boolean;
	reason?: string;
	violations: string[];
};

function normalize(values: string[] | undefined): Set<string> {
	return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export function evaluatePolicy(config: PolicyConfig | undefined, request: PolicyRequest): PolicyDecision {
	const rule = request.kind === "background_task" ? config?.backgroundTask : config?.loopTrigger;
	if (!rule) {
		return { allowed: true, violations: [] };
	}

	const violations: string[] = [];
	const agent = request.agent?.trim().toLowerCase();
	const allowedAgents = normalize(rule.allowedAgents);
	const deniedAgents = normalize(rule.deniedAgents);

	if (agent && allowedAgents.size > 0 && !allowedAgents.has(agent)) {
		violations.push(`agent not allowed: ${agent}`);
	}
	if (agent && deniedAgents.has(agent)) {
		violations.push(`agent denied: ${agent}`);
	}

	const deniedTools = normalize(rule.deniedTools);
	for (const rawTool of request.requestedTools ?? []) {
		const tool = rawTool.trim().toLowerCase();
		if (!tool) continue;
		if (deniedTools.has(tool)) {
			violations.push(`tool denied: ${tool}`);
		}
	}

	if (typeof rule.maxPromptChars === "number" && Number.isFinite(rule.maxPromptChars) && rule.maxPromptChars > 0) {
		const promptLength = request.prompt?.length ?? 0;
		if (promptLength > rule.maxPromptChars) {
			violations.push(`prompt too long: ${promptLength} > ${rule.maxPromptChars}`);
		}
	}

	for (const pattern of rule.deniedPatterns ?? []) {
		const normalized = pattern.trim();
		if (!normalized) continue;
		const prompt = request.prompt ?? "";
		if (prompt.toLowerCase().includes(normalized.toLowerCase())) {
			violations.push(`prompt matched denied pattern: ${normalized}`);
		}
	}

	if (rule.requireTriggerSource && request.kind === "loop_trigger") {
		if (!request.triggerSource || !request.triggerSource.trim()) {
			violations.push("trigger source required by policy");
		}
	}

	if (violations.length > 0) {
		return {
			allowed: false,
			reason: "policy denied request",
			violations,
		};
	}

	return {
		allowed: true,
		violations,
	};
}
