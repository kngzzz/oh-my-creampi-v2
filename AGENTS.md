# oh-my-creampi v2 — Developer Guide

Authoritative behavior comes from `SPEC.md`.

## Architecture (Final)

```
.pi/extensions/oh-my-creampi/
├── index.ts
├── lib/
│   ├── types.ts
│   ├── util.ts
│   ├── background.ts
│   ├── agents.ts
│   ├── agent-loader.ts
│   ├── agent-runner.ts
│   ├── config.ts
│   ├── primitives/
│   │   ├── types.ts
│   │   ├── kernel.ts
│   │   ├── policy.ts
│   │   ├── freshness.ts
│   │   ├── admission.ts
│   │   ├── guardrails.ts
│   │   ├── idempotency.ts
│   │   └── condition-engine.ts
│   └── loops/
│       ├── types.ts
│       ├── loader.ts
│       ├── runtime-state.ts
│       └── runtime.ts
└── tests/
```

## Tool Surface (6 tools)

1. `background_task`
2. `background_status`
3. `background_cancel`
4. `loop_trigger`
5. `loop_status`
6. `guardrail_add`

## Commands (3 commands)

- `/creampi`
- `/creampi-loops`
- `/creampi-health`

## Primitive Wiring Guarantees

All primitives are in the live execution path (no decorative modules):

- **Policy**: blocks `background_task`, blocks `loop_trigger`
- **AdmissionController**: blocks `background_task` at capacity
- **IdempotencyLedger**: blocks duplicate `background_task` and duplicate `loop_trigger`
- **GuardrailMemory**: prepends lessons to prompts in `background_task` and `loop_trigger`
- **HarnessKernel**: tracks work item lifecycle, leases, traces, handoffs
- **ConditionEngine**: blocks `loop_trigger` in shouldRun phase
- **Freshness hash**: included in kernel handoff contract

## Runtime Model

- Background runtime is FIFO + bounded concurrency.
- Loop runtime executes fixed 8 phases:
  `trigger → shouldRun → context → execute → evaluate → learn → handoff → retrigger`
- Loop checkpoints are persisted to `.creampi/checkpoints`.

## Profiles and Awareness Docs

- Default agents: `.pi/agents/{sisyphus,oracle,prometheus}.md`
- Kernel awareness doc: `.pi/kernel-awareness.md`

## Testing

- `npm test` runs all smoke tests via Node test runner (`tsx --test ...`)
- Current suite: **63 tests**
- Coverage includes:
  - every primitive,
  - blocking behavior assertions,
  - background + loop runtime integration,
  - tool/command registration and smoke paths.

## Development Rules

- Keep implementation aligned with `SPEC.md`.
- Keep runtime simple: kernel primitives first, features second.
- Avoid adding extra systems outside the spec.
