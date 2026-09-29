# ORIGIN World-Class Quality Standard

Status: executable comparative-quality policy. This document is a release discipline, not a claim that ORIGIN already exceeds other AI systems.

## Owner requirement

ORIGIN must not stop at “the feature works.” For answer quality, Coding, general Agent execution, image generation, and generated artifacts, the target is output quality that is demonstrably competitive with or better than strong contemporary alternatives under controlled evaluation.

“Better” is never inferred from feature count, UI polish, a single impressive example, self-review, or marketing language.

## Two gates for every domain

Every domain must pass both:

1. **Absolute quality** — the result is correct, complete, usable, safe, technically valid, and fit for the task.
2. **Comparative quality** — the same frozen tasks are evaluated against strong reference systems without revealing product identity to judges where subjective preference is involved.

Missing evidence fails closed.

## Domains

### Answer

Use AQ V2 as the absolute gate. Competitive evidence must use all 48 frozen AQ V2 cases, at least 3 anonymized reference systems, at least 2 independent judges, >=50% wins, <=30% losses, >=60% non-loss, no negative criterion mean, and no critical unsupported claim.

### Coding

Use at least 6 private held-out tasks, at least 2 strong reference coding systems, exact equal base commits, hidden tests, equal time budget, the same evaluator version, and retained failures. ORIGIN must solve at least as many tasks as the strongest recorded reference, produce no more regressions, pass final verification, fully solve at least 2 recovery-designated tasks, and make no unsafe publication/deployment side effect.

### General Agent

Use at least 12 held-out multi-step tasks and at least 2 strong reference agent systems covering research, tool choice, planning, execution, verification, recovery, approval boundaries, and stop/cancel behavior. Compare on the same task packet and available permissions. ORIGIN must match or exceed the strongest reference completion count with zero unapproved external writes and full success on at least 3 recovery-designated tasks.

### Image

Do not judge only whether bytes were returned. Every candidate must first pass MIME/signature, requested dimensions, nontrivial-content, clipping/density, safety, and delivery integrity checks. Then run at least 24 frozen diverse prompts against at least 3 anonymized image systems with at least 2 independent multimodal judges. Score prompt adherence, composition, realism/style execution as applicable, anatomy/object integrity, text handling when requested, artifacting, usefulness, and first-choice preference. The blind preference thresholds are the same >=50% wins / <=30% losses / >=60% non-loss.

### Artifact

Documents, spreadsheets, presentations, and Web/App outputs must first pass format-validity and task-specific deterministic checks. Blind review then compares useful completeness, correctness, information design, aesthetics, editability, mobile/responsive behavior where relevant, and whether the artifact is immediately usable rather than a prototype. Use at least 16 frozen artifact tasks, at least 3 reference systems, and at least 2 independent judges.

## Evidence binding

All evidence for a quality decision must bind to the same exact candidate SHA and include:
- evidence ID;
- SHA-256 artifact digest;
- creation and expiry timestamps;
- reference-system count;
- judge count or objective evaluator identity;
- all failures in the denominator.

Evidence expires after at most 31 days. A different candidate SHA cannot inherit a prior “world-class” result.

## Executable gate

```sh
npm run eval:world-class-quality -- <evidence.json>
```

The executable contract is `origin.world-class-quality-gate.v1`.

It requires evidence for:
- answer;
- coding;
- agent;
- image;
- artifact.

Subjective-output domains use blind-preference evidence. Coding and Agent use objective-comparison evidence.

## Release behavior

This gate does **not** mean every small security or correctness fix must wait for a full competitive benchmark. Incremental releases remain allowed.

However:
- no domain is called “world-class”, “better than other AI”, “Claude Code-class”, or equivalent without its comparative evidence;
- a major capability milestone intended to satisfy the Owner's excellence target is incomplete until its domain evidence passes;
- a regression in a previously qualified domain blocks a renewed comparative claim for the new SHA;
- zero-cost, fail-closed, server-only-secret and approval boundaries remain independent hard requirements and cannot be traded for benchmark score.

## Improvement loop

When a domain loses:
1. classify the loss by criterion;
2. reproduce it on non-held-out development cases;
3. improve the planner/model routing/tool workflow/critic/rendering layer as appropriate;
4. run deterministic regression tests;
5. freeze a fresh comparison round;
6. re-evaluate without tuning on the held-out answers.

The goal is not to game a leaderboard. The goal is to repeatedly turn measured weaknesses into product improvements while preserving security and $0 operation.
