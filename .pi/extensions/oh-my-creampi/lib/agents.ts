import type { AgentProfile } from "./types";

const AGENT_ALIASES: Record<string, string> = {
	default: "sisyphus",
	pi: "sisyphus",
};

function normalizeName(name: string): string {
	return name.trim().replace(/^@+/, "").toLowerCase();
}

export function getBuiltinAgentProfiles(): AgentProfile[] {
	return [
		{
			name: "sisyphus",
			description: "General-purpose coding agent",
			backend: "pi",
			tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob", "Task"],
			systemPrompt:
				"You are a focused coding agent. Complete your assigned task thoroughly. Read the codebase before making changes. Run tests after modifications.",
			source: "builtin",
		},
		{
			name: "oracle",
			description: "Analysis and research agent",
			backend: "pi",
			tools: ["Read", "Grep", "Glob", "Bash"],
			systemPrompt:
				"You are a read-only analysis agent. Examine code, data, or documents. Produce clear findings. Do not modify files unless explicitly asked.",
			source: "builtin",
		},
		{
			name: "prometheus",
			description: "Planning and decomposition agent",
			backend: "pi",
			tools: ["Read", "Grep", "Glob"],
			systemPrompt:
				"You are a planning agent. Break complex tasks into steps. Identify dependencies, risks, and verification criteria. Do not implement — only plan.",
			source: "builtin",
		},
	];
}

export function mergeAgentProfiles(base: AgentProfile[], incoming: AgentProfile[]): AgentProfile[] {
	const map = new Map<string, AgentProfile>();
	for (const profile of base) {
		map.set(normalizeName(profile.name), profile);
	}
	for (const profile of incoming) {
		map.set(normalizeName(profile.name), profile);
	}
	return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export class AgentRegistry {
	private profiles = new Map<string, AgentProfile>();

	constructor(initialProfiles: AgentProfile[]) {
		this.setProfiles(initialProfiles);
	}

	setProfiles(profiles: AgentProfile[]): void {
		this.profiles.clear();
		for (const profile of profiles) {
			this.profiles.set(normalizeName(profile.name), profile);
		}
	}

	get(name: string | undefined): AgentProfile | undefined {
		if (!name) return undefined;
		const key = normalizeName(name);
		const direct = this.profiles.get(key);
		if (direct) return direct;
		const alias = AGENT_ALIASES[key];
		if (!alias) return undefined;
		return this.profiles.get(normalizeName(alias));
	}

	list(): AgentProfile[] {
		return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	resolve(preferredAgent: string | undefined, fallback = "sisyphus"): AgentProfile | undefined {
		const preferred = this.get(preferredAgent);
		if (preferred) return preferred;
		return this.get(fallback);
	}
}
