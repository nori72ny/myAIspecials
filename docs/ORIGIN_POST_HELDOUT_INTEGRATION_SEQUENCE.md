# ORIGIN — Post-Held-Out Integration Sequence

## Goal

Define the exact merge and validation order after the official V1.4 final unseen qualification completes.

## Current frozen state

- Production/main frozen at:
  `f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`
- UI/UX implementation stack remains draft/unmerged.
- Answer-quality PR #331 remains planning/documentation only.

## Integration principle

Do not merge the historical UI/UX PRs independently into main one by one after held-out.

Instead:

1. freeze held-out evidence;
2. create one fresh post-held-out integration branch from frozen main;
3. replay/merge the already validated UI/UX stack into that branch in dependency order;
4. implement answer-quality AQ slices on top;
5. run one exact-head full release qualification;
6. merge that qualified head to main;
7. verify production SHA equality.

This avoids publishing intermediate partially integrated states.

## UI/UX dependency order

Required ancestry:

1. Phase 6 Research Sources — PR #319
2. Phase 7 Project Workspace — PR #323
3. Phase 8 Mobile UX — PR #325
4. Phase 9 Accessibility — PR #327
5. Phase 10 Polish — PR #329

Current validated final UI/UX stack head:
`f6955b51bb4817811bcf6addb643ea7e22460fb0`

Before reuse, verify no unexpected branch drift.

## Answer-quality order

On the fresh integration branch:

1. AQ-1 Evidence Ledger
2. AQ-2 Claim Model
3. AQ-3 Independent Verifier
4. AQ-4 Chat Integration
5. AQ-5 Research Integration
6. AQ-6 Repair Loop
7. AQ-7 Presenter/UI state
8. AQ-8 Benchmark Harness

Each AQ slice gets focused unit tests before the next slice.

## Baseline benchmark timing

Baseline must be run after UI/UX stack integration but before AQ runtime changes.

Reason:
- isolates answer-quality change from UI changes;
- compares the same user-facing structural stack;
- avoids crediting UI improvements as answer-quality improvement.

Freeze:
- benchmark version;
- integration SHA;
- raw baseline outputs.

## Candidate benchmark timing

Run after AQ-1 through AQ-8 are complete.

Use:
- exact same benchmark version;
- same scoring implementation version;
- same zero-cost constraints.

## Promotion gate

Candidate cannot promote if:
- fail-closed accuracy regresses;
- verification integrity regresses;
- coding verification semantics weaken;
- paid fallback appears;
- total cost > USD 0;
- secret/privacy regression appears;
- critical E2E/security/release gate fails.

## Full exact-head validation

Required on final integration head:

- install with approved script policy;
- lint;
- typecheck;
- unit tests;
- build;
- Node 22/24;
- E2E desktop/mobile;
- Lighthouse;
- accessibility checks;
- Artifact isolation Chromium/Firefox/WebKit;
- Research source UI tests;
- Agent action/Stop behavior;
- Coding hosted sandbox;
- coding production smoke where safe/authorized;
- ACOS;
- CodeQL;
- OpenSSF;
- Dependency Review;
- secret scan;
- free-only policy checks;
- provider failure/fail-closed tests;
- Vercel Preview success.

## Main merge

Only merge the exact validated integration head.

Immediately after merge:
- read main SHA;
- wait for Production deployment;
- confirm Vercel Production commit SHA == main SHA;
- verify /api/health;
- verify releaseSha;
- verify no-store;
- verify cost=0;
- smoke chat;
- smoke research;
- smoke coding;
- inspect runtime errors.

## Rollback

Record pre-release production SHA:
`f0c1bff22d3246d3eac3903b9def5d3aa7c1e498`

If critical smoke or security check fails:
- do not patch production blindly;
- restore last known-good production;
- diagnose on a branch;
- requalify exact head.

## Owner report

After successful production promotion report:
- released version;
- public production URL;
- main SHA;
- Production deployment SHA;
- health result;
- UI/UX visible status;
- answer-quality Before/After metrics;
- coding verification result;
- cost USD;
- known limitations;
- rollback SHA.
