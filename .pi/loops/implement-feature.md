---
name: implement-feature
version: 1
description: Implement a new feature following TDD - write tests first, then implement, then verify
trigger:
  type: manual
agent: sisyphus
backend: pi
timeout: 600
max_concurrent: 1
cooldown: 0
max_retries: 1
eval:
  type: exit_code
  pass_condition: 0
  blocking: true
inputs:
  feature: New feature description
  target_dir: src
budget:
  maxTokens: 150000
  maxCostUsd: 2.00
  maxDurationSec: 600
---
Implement the following feature: {feature}

## Steps

1. **Understand existing patterns**: Read code in {target_dir} to understand the codebase structure, naming conventions, and testing patterns.

2. **Write failing tests first**: Create test cases for {feature} that currently fail. Tests should cover happy path, edge cases, and error conditions.

3. **Implement the feature**: Write the minimal code needed to make all tests pass. Follow existing code patterns and style.

4. **Run full test suite**: Execute all tests to ensure no regressions. Fix any failures immediately.

5. **Summary**: Provide a brief summary of:
   - What was implemented
   - Key design decisions
   - Test coverage
   - Any limitations or future improvements
