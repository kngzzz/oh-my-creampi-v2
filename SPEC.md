# oh-my-creampi v2 — Build Spec

## Philosophy

Chief's UX, CreamPi's kernel. ~3,000 LOC extension that does ONE thing well: runs agent loops with real kernel primitives.

No teams. No web dashboard. No tmux. No verification swarm. No release engineering.
Just: define a loop → trigger it → agent runs → primitives enforce safety → guardrails compound.

## Architecture

```
.pi/extensions/oh-my-creampi/
├── index.ts                    # Entry point — 6 tools, 3 commands (~400 LOC)
├── lib/
│   ├── background.ts           # BackgroundTaskManager — FIFO queue, spawn agents (~600 LOC)
│   ├── agents.ts               # AgentRegistry — profile resolution (~150 LOC)
│   ├── agent-runner.ts         # Multi-backend spawning: pi | claude | codex (~300 LOC)
│   ├── agent-loader.ts         # Frontmatter .pi/agents/*.md loading (~80 LOC)
│   ├── config.ts               # Config loader — minimal (~200 LOC)
│   ├── types.ts                # Core types (~150 LOC)
│   ├── util.ts                 # Shared utilities (~50 LOC)
│   ├── primitives/
│   │   ├── index.ts            # Barrel export
│   │   ├── types.ts            # WorkItem, Lease, Handoff, Trace types (~150 LOC)
│   │   ├── kernel.ts           # HarnessKernel — state machine (~350 LOC)
│   │   ├── policy.ts           # Policy enforcement — BLOCKING (~100 LOC)
│   │   ├── freshness.ts        # SHA256 freshness hashing (~30 LOC)
│   │   ├── admission.ts        # AdmissionController (~150 LOC)
│   │   ├── guardrails.ts       # GuardrailMemory (~150 LOC)
│   │   ├── idempotency.ts      # IdempotencyLedger (~120 LOC)
│   │   └── condition-engine.ts # Precondition evaluation (~200 LOC)
│   └── loops/
│       ├── index.ts            # Barrel export
│       ├── types.ts            # Loop definition types (~80 LOC)
│       ├── loader.ts           # Discover .pi/loops/*.md (~150 LOC)
│       ├── runtime.ts          # Loop execution engine (~400 LOC)
│       └── runtime-state.ts    # State machine for loop phases (~100 LOC)
└── tests/                      # Target: ~1,500 LOC, ~40 tests
    ├── kernel.smoke.test.ts
    ├── background.smoke.test.ts
    ├── policy.smoke.test.ts
    ├── admission.smoke.test.ts
    ├── guardrails.smoke.test.ts
    ├── idempotency.smoke.test.ts
    ├── loop-runtime.smoke.test.ts
    └── loop-loader.smoke.test.ts
```

## Tools (6 total)

### 1. `background_task`
Launch a one-off agent task.
```typescript
params: {
  description: string,  // Short task description
  prompt: string,       // Full prompt for the agent
  agent?: string,       // Agent profile name (default: "sisyphus")
  timeoutSec?: number   // Timeout (0 = no timeout)
}
```
Before launching:
1. Check `evaluatePolicy()` — block if denied
2. Check `admissionController.admit()` — block if over concurrency
3. Check `idempotencyLedger.check()` — block if duplicate within TTL
4. Read `guardrailMemory` for agent domain — prepend to prompt if entries exist
5. Register WorkItem in kernel, acquire lease
6. Spawn agent via `agent-runner.ts`

### 2. `background_status`
Get status and output of a background task.
```typescript
params: { taskId: string }
returns: { id, status, agent, output, usage, error, duration }
```

### 3. `background_cancel`
Cancel a running or queued task.
```typescript
params: { taskId: string }
```

### 4. `loop_trigger`
Trigger a named loop.
```typescript
params: { loopName: string, triggerSource?: string }
```
Uses LoopRuntime to execute the full 8-phase lifecycle:
trigger → shouldRun → context → execute → evaluate → learn → handoff → retrigger

### 5. `loop_status`
Show loop state and last checkpoint.
```typescript
params: { loopName?: string }  // omit for all loops
returns: { loops: [{ name, lastRun, status, nextScheduled }] }
```

### 6. `guardrail_add`
Add a guardrail entry from current session.
```typescript
params: { domain: string, lesson: string, severity?: "info" | "warning" | "critical" }
```
Appends to `.creampi/guardrails/{domain}.md`

## Commands (3 total)

### `/creampi`
Status dashboard showing:
- Active/queued background tasks
- Discovered loops and their state
- Guardrail count per domain
- Config summary

### `/creampi-loops`
List discovered loops with trigger history and next scheduled time.

### `/creampi-health`
Backend preflight — check if pi/claude/codex CLIs are available.

## Kernel Primitives (all MUST be wired into runtime)

Every primitive is called from the actual execution path. No decorative primitives.

| Primitive | Wired into | Enforcement |
|-----------|-----------|-------------|
| Policy | `background_task`, `loop_trigger` | **Blocking** — denied = task rejected |
| AdmissionController | `background_task` | **Blocking** — over capacity = task rejected |
| IdempotencyLedger | `background_task`, `loop_trigger` | **Blocking** — duplicate = task rejected |
| GuardrailMemory | `background_task`, `loop_trigger` | **Injected** — prepended to agent prompt |
| HarnessKernel | `background_task` | **Tracking** — work items, leases, transitions, handoffs |
| ConditionEngine | `loop_trigger` shouldRun phase | **Blocking** — precondition failed = loop skipped |
| Freshness | handoff creation | **Hashing** — integrity verification |

## Agent Profiles

Ship with 3 default profiles in `.pi/agents/`:

### sisyphus.md (general worker)
```yaml
---
name: sisyphus
description: General-purpose coding agent
backend: pi
tools: [Read, Write, Edit, Bash, Grep, Glob, Task]
---
You are a focused coding agent. Complete your assigned task thoroughly.
Read the codebase before making changes. Run tests after modifications.
```

### oracle.md (analysis/research)
```yaml
---
name: oracle
description: Analysis and research agent
backend: pi
tools: [Read, Grep, Glob, Bash]
---
You are a read-only analysis agent. Examine code, data, or documents.
Produce clear findings. Do not modify files unless explicitly asked.
```

### prometheus.md (planning)
```yaml
---
name: prometheus
description: Planning and decomposition agent
backend: pi
tools: [Read, Grep, Glob]
---
You are a planning agent. Break complex tasks into steps.
Identify dependencies, risks, and verification criteria.
Do not implement — only plan.
```

## Situational Awareness Document

Create `.pi/kernel-awareness.md` — injected into every agent's context automatically:

```markdown
# How to Set Yourself Up for Success

You are an agent running inside an orchestration kernel. You don't need to know
how the kernel works — just think about what you need to succeed.

## Before You Start
- **Read your task carefully.** What does "done" look like?
- **Check guardrails.** Past runs left lessons. Don't repeat mistakes.
- **Respect your budget.** You have a token/time limit. Plan accordingly.

## While You Work
- **Stay focused.** One task at a time. Don't scope-creep.
- **Verify your output.** If there are eval criteria, check against them.
- **Stop if stuck.** Better to report "I'm stuck on X" than spin indefinitely.

## When You Finish
- **Write a clear summary.** What you did, what worked, what's left.
- **Note what you learned.** If something surprised you, it's a future guardrail.
- **Be honest about quality.** "Done but untested" ≠ "done."
```

## Config Format

`.pi/oh-my-creampi.jsonc`:
```jsonc
{
  // Agent defaults
  "defaultAgent": "sisyphus",
  "defaultBackend": "pi",
  "defaultModel": "gpt-5.3-codex",

  // Concurrency
  "maxConcurrency": 3,
  "defaultTimeoutSec": 300,

  // Guardrails
  "guardrailsDir": ".creampi/guardrails",
  
  // Idempotency
  "idempotencyDir": ".creampi/idempotency",
  "idempotencyTtlSec": 600,

  // Loop checkpoints
  "checkpointsDir": ".creampi/checkpoints",

  // Backend overrides
  "backends": {
    "pi": { "provider": "openai-codex", "model": "gpt-5.3-codex" },
    "claude": { "provider": "anthropic", "model": "claude-opus-4-6" },
    "codex": { "provider": "openai-codex", "model": "codex-5.3" }
  }
}
```

## Loop Definition Format

`.pi/loops/example.md`:
```yaml
---
name: example-loop
version: 1
description: What this loop does
trigger:
  type: manual  # or: cron, event
  schedule: "0 15 * * 1-5"  # cron only
agent: oracle
backend: pi
timeout: 120
max_concurrent: 1
cooldown: 300  # seconds between runs
max_retries: 2
eval:
  type: exit_code
  pass_condition: 0
  blocking: true
inputs:
  market: ETH
  timeframe: 4H
budget:
  maxTokens: 50000
  maxCostUsd: 0.50
  maxDurationSec: 120
---
Analyze {market} on {timeframe} timeframe.

Check current price action against ICT methodology.
Identify key levels: order blocks, fair value gaps, liquidity pools.

Output a structured analysis with:
1. Bias (bullish/bearish/neutral)
2. Key levels with prices
3. Recommended action (if any)
4. Confidence level (1-5)
```

## Testing Requirements

- All tests use Node.js built-in test runner (`node:test`)
- `npm test` runs all tests
- Target: 40+ tests covering every tool and primitive integration point
- Every primitive must have a test proving it BLOCKS execution (not just logs)
- Every tool must have a basic smoke test

## Build Order

1. `lib/types.ts` + `lib/util.ts` — foundation types
2. `lib/primitives/*` — kernel primitives (all blocking)
3. `lib/agents.ts` + `lib/agent-loader.ts` + `lib/agent-runner.ts` — agent infrastructure
4. `lib/loops/*` — loop runtime
5. `lib/background.ts` — task manager (wires ALL primitives)
6. `lib/config.ts` — config loader
7. `index.ts` — extension entry point (6 tools, 3 commands)
8. `tests/*` — comprehensive tests
9. `.pi/agents/*.md` — default profiles
10. `.pi/kernel-awareness.md` — situational awareness document
11. `AGENTS.md` — developer guide

## Reference Files

You can read these files from the v1 codebase for reference (do NOT copy verbatim — simplify):
- `/home/kng/projects/oh-my-creampi/.pi/extensions/oh-my-creampi/lib/primitives/kernel.ts` (HarnessKernel)
- `/home/kng/projects/oh-my-creampi/.pi/extensions/oh-my-creampi/lib/primitives/policy.ts` (Policy)
- `/home/kng/projects/oh-my-creampi/.pi/extensions/oh-my-creampi/lib/background.ts` (BackgroundTaskManager — simplify heavily)
- `/home/kng/projects/oh-my-creampi/.pi/extensions/oh-my-creampi/lib/loops/runtime.ts` (LoopRuntime — simplify)
- `/home/kng/projects/oh-my-creampi/.pi/extensions/oh-my-creampi/lib/loops/loader.ts` (loader)
- `/home/kng/projects/oh-my-creampi/.pi/extensions/oh-my-creampi/lib/agents.ts` (AgentRegistry)
- `/home/kng/projects/oh-my-creampi/.pi/extensions/oh-my-creampi/lib/agent-runner.ts` (spawning)

## Constraints

- **TypeScript only. Strict types. No `any`.**
- **Every primitive MUST be wired into runtime. No decorative code.**
- **Run `npm test` after every file. Stay green.**
- **One commit per logical unit. Clean messages.**
- **Target ~3,000 LOC extension + ~1,500 LOC tests.**
- **If you find yourself building something not in this spec, STOP.**
