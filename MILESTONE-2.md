# Milestone 2: Kernel Awareness Injection + Self-Improving Workspace

## Goal
Every agent spawned by the kernel receives situational awareness (what tools exist, what went wrong before) automatically injected into its prompt. After each run, the agent writes guardrails that improve the next run.

## What Exists
- `kernel-awareness.md` exists in `.pi/` (seed file, ships with extension)
- `guardrails.ts` has `renderForPrompt(domain)` that reads `.creampi/guardrails/*.md`
- `guardrail_add` tool lets agents write lessons after runs
- Background task manager and loop runtime both call `runAgent()` with a prompt

## What's Missing
The prompt sent to `runAgent()` doesn't include kernel awareness or guardrails. The agent runs blind.

## Changes Required

### 1. Add `readKernelAwareness()` utility (lib/util.ts)

```typescript
export async function readKernelAwareness(projectRoot: string): Promise<string> {
  const awarenessPath = path.join(projectRoot, ".pi", "kernel-awareness.md");
  try {
    return (await fs.promises.readFile(awarenessPath, "utf8")).trim();
  } catch {
    return "";
  }
}

export function composeKernelPrompt(kernelAwareness: string, guardrails: string, prompt: string): string {
  const sections = [
    kernelAwareness ? `## Kernel Awareness\n${kernelAwareness}` : "",
    guardrails ? `## Guardrails (lessons from past runs)\n${guardrails}` : "",
    "---",
    prompt,
  ].filter(s => s.trim().length > 0);
  return sections.join("\n\n");
}
```

### 2. Wire into BackgroundTaskManager (lib/background.ts)

In the `drain()` method, before calling the agent runner, compose the prompt:

```typescript
// Before the runAgent call in drain():
const kernelAwareness = await readKernelAwareness(this.projectRoot);
const domain = item.input.domain ?? item.input.agent ?? "general";
const guardrails = await this.guardrails.renderForPrompt(domain);
const composedPrompt = composeKernelPrompt(kernelAwareness, guardrails, item.input.prompt);
// Pass composedPrompt instead of item.input.prompt to the agent
```

Requirements:
- `projectRoot` must be available in BackgroundTaskManager (add to constructor/deps if not already)
- `guardrails` (GuardrailMemory instance) must be accessible (check if already wired)

### 3. Wire into LoopRuntime (lib/loops/runtime.ts)

In the `trigger()` method, before launching the agent:

```typescript
// Before building the launch input:
const kernelAwareness = await readKernelAwareness(this.projectRoot);
const domain = loop.name;
const guardrails = await this.guardrails.renderForPrompt(domain);
const composedPrompt = composeKernelPrompt(kernelAwareness, guardrails, expandedPrompt);
// Use composedPrompt in the launch input
```

Requirements:
- `projectRoot` must be available in LoopRuntime options
- `guardrails` must be accessible (check existing wiring)

### 4. Propagate `projectRoot` through dependencies

Check if BackgroundTaskManager and LoopRuntime already receive the project root. If not, add it:
- In `index.ts` where runtime is initialized, pass `root` (the resolved project root)
- Thread it through to wherever `runAgent` or `launch` is called

### 5. Create workspace scaffold command: `/creampi-init`

Register a new command in index.ts:

```typescript
pi.registerCommand("creampi-init", {
  description: "Initialize CreamPi workspace files for current project",
  handler: async (args, ctx) => {
    const root = resolveProjectRoot(ctx.cwd);
    const dirs = [
      path.join(root, ".pi", "loops"),
      path.join(root, ".pi", "agents"),
      path.join(root, ".creampi", "guardrails"),
      path.join(root, ".creampi", "checkpoints"),
    ];
    for (const dir of dirs) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    
    // Write kernel-awareness.md if it doesn't exist
    const awarenessPath = path.join(root, ".pi", "kernel-awareness.md");
    if (!fs.existsSync(awarenessPath)) {
      await fs.promises.writeFile(awarenessPath, KERNEL_AWARENESS_TEMPLATE, "utf8");
    }
    
    // Write a starter agent profile if none exist
    const agentsDir = path.join(root, ".pi", "agents");
    const existing = await fs.promises.readdir(agentsDir).catch(() => []);
    if (existing.length === 0) {
      await fs.promises.writeFile(
        path.join(agentsDir, "default.md"),
        DEFAULT_AGENT_TEMPLATE,
        "utf8"
      );
    }
    
    if (ctx.hasUI && ctx.ui) {
      ctx.ui.notify("CreamPi workspace initialized", "success");
    }
  },
});
```

The templates (`KERNEL_AWARENESS_TEMPLATE`, `DEFAULT_AGENT_TEMPLATE`) should be const strings at the top of the file. Keep them short — 20-30 lines each.

### 6. Tests

Add tests to verify:
- `readKernelAwareness()` returns content when file exists, empty string when missing
- `composeKernelPrompt()` correctly joins sections, filters empties
- Background task manager includes kernel awareness in the prompt sent to the agent (mock the runner, inspect the prompt it receives)
- Loop runtime includes kernel awareness in the prompt sent to the agent
- `/creampi-init` creates the expected directory structure

### 7. Commit

One commit: `feat: kernel awareness injection + /creampi-init workspace scaffold`

## Build Order
1. Add utilities to lib/util.ts
2. Wire into background.ts (check deps, add projectRoot if needed)
3. Wire into loops/runtime.ts (check deps, add projectRoot if needed)
4. Add /creampi-init command to index.ts
5. Write tests
6. `npm test` — must stay green (63+ tests)
7. Commit and push

## Constraints
- Don't restructure existing code — surgical additions only
- Don't add new primitives
- Keep templates under 30 lines each
- The compose function must handle any combination of empty/present sections gracefully
