---
name: refactor
version: 1
description: Refactor code to improve quality without changing behavior
trigger:
  type: manual
agent: sisyphus
backend: pi
timeout: 300
max_concurrent: 1
cooldown: 0
max_retries: 1
eval:
  type: exit_code
  pass_condition: 0
  blocking: true
inputs:
  target: src/module.ts
  goal: Improve readability and reduce complexity
budget:
  maxTokens: 100000
  maxCostUsd: 1.00
  maxDurationSec: 300
---
Refactor code at {target} to achieve: {goal}

## Steps

1. **Analyze current code**: Read {target} and understand its current behavior, test coverage, and dependencies.

2. **Plan refactoring**: Identify specific improvements needed to achieve {goal}. Document the plan before making changes.

3. **Refactor incrementally**: Make changes in small, testable chunks. After each change, run tests to ensure behavior is preserved.

4. **Verify no regressions**: Run the full test suite. All tests must pass - this is a behavior-preserving refactor only.

5. **Summary**: Document:
   - What was refactored and why
   - Metrics improved (e.g., cyclomatic complexity, lines of code)
   - Test results confirming no behavior changes
