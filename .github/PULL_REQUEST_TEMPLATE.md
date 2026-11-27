## Outcome
<!-- One sentence: what user-visible or system outcome does this PR deliver? -->

## Change contract
- [ ] Acceptance criteria are binary and testable.
- [ ] Non-goals are listed.
- [ ] Protected invariants are listed.
- [ ] This PR contains one primary outcome; unrelated changes are split.

### Acceptance criteria
1.
2.

### Non-goals
-

### Protected invariants
- [ ] $0.00 / Free-only / no paid fallback (where applicable)
- [ ] Strict ZDR and data minimization (where applicable)
- [ ] No secrets in source, browser bundles, logs, or artifacts
- [ ] No unapproved production/account/billing mutation

## Change impact
- [ ] S0 isolated
- [ ] S1 local contract
- [ ] S2 cross-system
- [ ] S3 release boundary

Affected modules / consumers:
-
Impact rationale:

## Reopening / regression context
- Is this new work or reopening accepted work?
- If reopening, cite the trigger and prior acceptance record:
- Why was the issue not caught earlier?
- What prevents recurrence?
- Regression tests selected and why:

## Verification (exact candidate SHA)
- Candidate SHA:
- Targeted command(s):
- Test result / run URL:
- Required CI result / run URL:
- Runtime environment (if executed):
- Evidence labels: CODE-PROVEN / TEST-COVERED / CI-PASSED / EXECUTED / UNVERIFIED / NOT_MEASURED

## Independent review
- Implementation reviewer / result:
- Security & privacy reviewer / result:
- Release reviewer / result:
- Reviewer SHA (must equal candidate SHA):
- Findings and disposition:

## Cost, privacy, and operational evidence
- Provider/model/route:
- Free-plan evidence and observation time:
- ZDR / retention evidence:
- Actual cost evidence (if not measured, write NOT_MEASURED):
- Secrets / permissions / rollback:

## Integration and branch topology
- Base branch and base SHA:
- Parent PR (if stacked):
- Merge order / rebase plan:
- Dependent PRs or workflows affected:

## Release impact
- [ ] No production behavior change
- [ ] Preview-only
- [ ] Production behavior change (requires explicit approval)
- [ ] Rollback plan documented
- [ ] No merge/deploy/live inference is being requested implicitly

## Final disposition
- [ ] PASS
- [ ] CONDITIONAL
- [ ] FAIL
- [ ] UNVERIFIED

Unresolved blockers:
