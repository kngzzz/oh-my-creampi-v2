---
name: fix-bug
version: 1
description: Diagnose and fix a bug with minimal changes
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
  bug_description: What is broken
  reproduction: How to reproduce or where the bug is
budget:
  maxTokens: 80000
  maxCostUsd: 0.80
  maxDurationSec: 300
---
Fix the following bug: {bug_description}

## Steps

1. **Locate the bug**: Read code at {reproduction} to understand the relevant implementation.

2. **Understand the issue**: Analyze the expected vs actual behavior from {bug_description}. Identify the root cause.

3. **Write a failing test**: Create a test that reproduces the bug and currently fails.

4. **Fix with minimal changes**: Apply the smallest fix possible to make the test pass. Do NOT refactor or make unrelated changes.

5. **Verify no regressions**: Run the full test suite. The new test must pass and all existing tests must remain green.

6. **Summary**: Document:
   - Root cause of the bug
   - The fix applied
   - Test results
   - Any follow-up work needed
