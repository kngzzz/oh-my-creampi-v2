# oh-my-creampi v2

Lightweight orchestration for `pi`: run background agent work and repeatable loops through a small, test-covered kernel.

This repo contains the v2 extension at:

- `.pi/extensions/oh-my-creampi/index.ts`

---

## What v2 ships

- **6 tools**
  - `background_task`
  - `background_status`
  - `background_cancel`
  - `loop_trigger`
  - `loop_status`
  - `guardrail_add`
- **3 slash commands**
  - `/creampi`
  - `/creampi-loops`
  - `/creampi-health`
- **Kernel primitives wired into live execution paths**
  - Policy, Admission, Idempotency, Guardrails, Kernel lifecycle, Condition evaluation, Freshness hashing
- **Default agent profiles**
  - `.pi/agents/sisyphus.md`
  - `.pi/agents/oracle.md`
  - `.pi/agents/prometheus.md`
- **Smoke/integration test suite**: currently **63 passing tests**

Authoritative product intent lives in [`SPEC.md`](./SPEC.md).

---

## Architecture (high level)

```text
.pi/extensions/oh-my-creampi/
├── index.ts                 # Entry: registers tools + commands
├── lib/
│   ├── background.ts        # FIFO background runtime + kernel wiring
│   ├── agents.ts            # Built-ins + registry
│   ├── agent-loader.ts      # .pi/agents/*.md discovery
│   ├── agent-runner.ts      # Spawn pi/claude/codex CLIs
│   ├── config.ts            # .pi/oh-my-creampi.json(c) loader
│   ├── primitives/          # Kernel primitives
│   └── loops/               # Loop loader + runtime (8 phases)
└── tests/                   # smoke + integration coverage
```

Runtime data is persisted under `.creampi/` (gitignored).

---

## Quick start

### Prerequisites

- Node.js 22+
- `pi` CLI installed and working

### Install deps + run tests

```bash
npm install
npm test
```

### Verify extension is active

From repo root:

```bash
pi -p "/creampi" --no-session
pi -p "/creampi-loops" --no-session
pi -p "/creampi-health" --no-session
```

You should see CreamPi status output, discovered loops, and backend health checks.

---

## Commands

### `/creampi`
Shows extension dashboard summary:

- project root/config source
- background queue/running/concurrency snapshot
- loop count
- guardrail domain count
- config/loop discovery warnings

### `/creampi-loops`
Lists discovered loops and checkpoint-derived status.

### `/creampi-health`
Checks availability of `pi`, `claude`, and `codex` CLIs.

---

## Tools reference

### 1) `background_task`
Launch one-off background work.

**Params**

```ts
{
  description: string;
  prompt: string;
  agent?: string;      // default: sisyphus
  timeoutSec?: number; // default: config.defaultTimeoutSec
}
```

**Behavior gates (in order):** policy -> admission -> idempotency -> guardrail injection -> kernel work item + lease -> spawn.

---

### 2) `background_status`
Get status/output for a task.

**Params**

```ts
{ taskId: string }
```

**Returns** status, output, usage, error, duration metadata.

---

### 3) `background_cancel`
Cancel queued/running task.

**Params**

```ts
{ taskId: string }
```

---

### 4) `loop_trigger`
Trigger a named loop.

**Params**

```ts
{
  loopName: string;
  triggerSource?: string;
}
```

Runs loop lifecycle phases:

`trigger -> shouldRun -> context -> execute -> evaluate -> learn -> handoff -> retrigger`

Possible statuses: `launched | skipped | duplicate | error` (and `prepared` for internal dry-run path).

---

### 5) `loop_status`
Read current loop status/checkpoint summary.

**Params**

```ts
{ loopName?: string } // omit for all
```

---

### 6) `guardrail_add`
Append a lesson to guardrail memory.

**Params**

```ts
{
  domain: string;
  lesson: string;
  severity?: "info" | "warning" | "critical";
}
```

Writes to:

- `.creampi/guardrails/<domain>.md`

---

## Defining loops

Create markdown files in `.pi/loops/*.md`.

Example:

```md
---
name: market-scan
version: 1
description: Quick ETH scan
trigger:
  type: manual
agent: oracle
backend: pi
timeout: 90
max_concurrent: 1
cooldown: 0
max_retries: 0
should_run: state.triggerSource == "allow"
eval:
  type: exit_code
  pass_condition: 0
  blocking: true
inputs:
  market: ETH
---

Analyze {market} quickly and return one short paragraph.
```

### Loop frontmatter notes

- `name` is required and must be unique across discovered loop files.
- `should_run` (or alias `run_if`) is evaluated by the condition engine.
- Prompt body supports template substitution like `{market}` and dotted paths.
- Discovery uses a YAML-like parser; keep frontmatter simple and explicit.

---

## Condition expressions (`should_run`)

Supported operators:

- unary: `!`
- boolean: `&&`, `||`
- comparisons: `==`, `!=`, `>`, `>=`, `<`, `<=`

Supported values:

- strings, numbers, booleans, `null`
- dotted identifiers (for example `state.triggerSource`)

Evaluation context includes:

- `inputs`
- `payload`
- `state.triggerType`
- `state.triggerSource`

---

## Guardrails and memory

Guardrail entries are append-only lines:

```text
- <ISO timestamp> [severity] <lesson>
```

At runtime:

- `background_task` prepends guardrails for the agent/domain
- `loop_trigger` prepends guardrails for the loop name

This creates compounding lessons across runs.

---

## Persistence layout

Under `.creampi/`:

- `guardrails/` -> guardrail lessons by domain
- `idempotency/` -> idempotency ledger entries (TTL-based)
- `checkpoints/` -> per-loop checkpoint/status files

This directory is gitignored by default.

---

## Configuration

Optional config file (searched upward from CWD):

- `.pi/oh-my-creampi.jsonc`
- `.pi/oh-my-creampi.json`

Default values:

```jsonc
{
  "defaultAgent": "sisyphus",
  "defaultBackend": "pi",
  "defaultModel": "gpt-5.3-codex",
  "maxConcurrency": 3,
  "defaultTimeoutSec": 300,
  "guardrailsDir": ".creampi/guardrails",
  "idempotencyDir": ".creampi/idempotency",
  "idempotencyTtlSec": 600,
  "checkpointsDir": ".creampi/checkpoints",
  "backends": {
    "pi": { "provider": "openai-codex", "model": "gpt-5.3-codex" },
    "claude": { "provider": "anthropic", "model": "claude-opus-4-6" },
    "codex": { "provider": "openai-codex", "model": "codex-5.3" }
  }
}
```

---

## Testing

Run all tests:

```bash
npm test
```

Current suite validates:

- primitive-level behavior (including blocking paths)
- background manager integration
- loop runtime integration
- tool/command registration and smoke execution

---

## Important v2 behavior constraints

To keep runtime minimal/deterministic, note the current surface:

- `loop_trigger` tool currently exposes `loopName` + `triggerSource` only.
- Loop metadata fields like `max_concurrent` and `max_retries` are parsed; current enforcement focuses on core safety gates (policy/admission/idempotency/conditions) and launch path.
- `trigger.type: cron` is supported as loop metadata; there is no built-in scheduler daemon in this repo.

---

## Development guidance

- Follow [`SPEC.md`](./SPEC.md) for behavior and scope.
- Keep primitives in real execution paths (no decorative modules).
- Prefer simple runtime mechanics over extra systems.
- Keep tests green.
- Enable the protected-kernel pre-commit hook before local development:
  - `git config core.hooksPath .githooks`
  - This blocks accidental commits to core control-plane files.
  - Use `CREAMPI_ALLOW_PROTECTED_CHANGES=1` only for intentional kernel updates.

For contributor-oriented notes, see [`AGENTS.md`](./AGENTS.md).
