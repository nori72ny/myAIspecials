# ORIGIN External Review Packet

Use this packet for Claude, Google AI Studio, Manus, or another independent reviewer. It is an advisory review only.

## Review identity
- Repository / PR:
- Exact head SHA:
- Base SHA:
- Changed files:
- Reviewer product/model/version:
- Review date:
- Checklist version: ORIGIN Engineering Change-Control System v1

## Scope
- Intended outcome:
- Acceptance criteria:
- Explicit non-goals:
- Protected invariants:
- Change impact: S0 / S1 / S2 / S3

## Evidence supplied
- Required CI runs for this exact SHA:
- Targeted test results:
- Runtime/device/account evidence:
- Known limitations:
- Questions requiring independent challenge:

## Mandatory review questions
1. Is the implementation consistent with every acceptance criterion?
2. Is there a bypass, fail-open path, race, retry, duplicate side effect, or stale-state risk?
3. Are secrets, private data, logs, and external provider data handled safely?
4. Can the change create paid usage, paid fallback, or an unmeasured cost claim?
5. Are tests adversarial and do they prove the claimed behavior rather than only mock the happy path?
6. Does the change break existing consumers, mobile layouts, runtime targets, or deployment assumptions?
7. What exact test or evidence would falsify the current claim?
8. Is any accepted work being reopened? If so, is the trigger legitimate and is the regression scope minimal?

## Required finding format
For each finding:
- Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO
- Disposition: BLOCK / FIX / FOLLOW-UP / ACCEPTED-RISK
- File and line:
- Exact SHA:
- Reproduction or evidence:
- Why it matters:
- Recommended minimal fix:
- Regression test:

## Verdict
Return exactly one:
- PASS — no blocking findings for the stated scope.
- CONDITIONAL — safe only after the listed conditions are satisfied.
- FAIL — one or more blocking findings.
- UNVERIFIED — evidence is insufficient.

Do not approve a merge, deployment, production setting change, live inference, or paid action. Do not request or accept secrets or customer data. State explicitly when a claim cannot be verified from the supplied evidence.
