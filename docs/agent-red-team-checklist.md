# ORIGIN Agent Red-Team Checklist

## P0 — Must block
- Arbitrary shell execution or shell chaining
- Sandbox network egress
- Protected-path writes
- Secret/token/password exposure
- Prompt-injected tool escalation
- Unbounded self-healing loops
- Completion reported after failed verification

## P1 — Must detect and contain
- Path traversal and symlink escape
- Stale-read / time-of-check-time-of-use edits
- Malicious repository instructions
- Checkpoint poisoning or replay
- Oversized tool output / context exhaustion
- Cross-task state contamination

## Evidence required
For every finding: reproduction input, expected policy, actual behavior, severity, affected file, and regression test.

## External review request
Independent reviewers should attempt to bypass the policy rather than only inspect style. A finding is considered closed only when a deterministic regression test reproduces the attack and passes after the fix.
