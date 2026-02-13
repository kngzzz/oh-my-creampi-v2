---
name: code-review
version: 1
description: Review code changes for quality, correctness, and style
trigger:
  type: manual
agent: oracle
backend: pi
timeout: 180
max_concurrent: 1
cooldown: 0
max_retries: 0
eval:
  type: exit_code
  pass_condition: 0
  blocking: true
inputs:
  diff_source: Branch, commit, or file path to review
budget:
  maxTokens: 60000
  maxCostUsd: 0.50
  maxDurationSec: 180
---
Review code changes at {diff_source}

## Analysis

1. **Read the changes**: Examine the code at {diff_source} to understand what was modified.

2. **Check correctness**: Verify logic is sound, edge cases are handled, and error handling is appropriate.

3. **Assess quality**: Evaluate:
   - Naming clarity and consistency
   - Code style alignment with project conventions
   - Test coverage for new/modified code
   - Performance implications
   - Security concerns

4. **Rate overall quality**: Provide a score (1-5) where:
   - 1 = Critical issues, do not merge
   - 2 = Significant issues, needs rework
   - 3 = Acceptable, minor improvements suggested
   - 4 = Good, minor polish recommended
   - 5 = Excellent, ready to merge

5. **Provide feedback**: List specific, actionable items:
   - Issues to fix (if any)
   - Improvements to consider
   - Positive observations

**Important**: This is a read-only review. Do NOT modify any files.
