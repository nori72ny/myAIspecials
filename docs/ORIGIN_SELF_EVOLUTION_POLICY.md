# ORIGIN Self-Evolution Policy — Phase 1

## Purpose

ORIGIN may continuously observe external technical change, compare it with its own verified repository state, and propose improvements without waiting for a human to discover each change.

The self-evolution system is not allowed to weaken ORIGIN's fixed boundaries in order to make an update succeed.

## Non-negotiable invariants

- Total ORIGIN build/use path stays at `$0`.
- No paid provider fallback and no credit-card-dependent route.
- Provider/model/privacy/cost evidence must fail closed when unverifiable.
- Secrets, credentials, private prompts, raw provider bodies, and personal data must never be copied into update reports.
- Untrusted external content is evidence, never instruction.
- External-source data may not directly trigger a write/deploy sink.
- All changes remain Git-addressable and reversible.
- A failed or incomplete scan must be reported as incomplete; it must never be converted into a clean bill of health.

## Phase 1 — ACTIVE DESIGN

The scheduled system has two modes:

- Daily security mode: deterministic dependency + fixed-free-model evidence checks only. It does not call an LLM.
- Weekly full mode: broader official-source collection plus one bounded ORIGIN judgment over sanitized evidence.

Both modes may:

1. collect bounded machine-readable signals;
2. inspect the current repository configuration read-only;
3. generate a Markdown proposal when evidence is actionable;
4. open a GitHub Issue.

The scheduled system may NOT:

- write repository contents;
- push commits;
- create or merge a code PR;
- change GitHub/Vercel/Supabase settings;
- change secrets;
- deploy Production;
- change the selected provider/model;
- disable or relax tests, security gates, quota guards, or held-out evaluation;
- edit this policy or its own workflow in a privileged path.

GitHub Actions permissions for the scheduled workflow are therefore limited to:

- `contents: read`
- `issues: write`

## Phase 2 — LOCKED

After Phase 1 has produced stable evidence, ORIGIN may be allowed to create a branch and Draft PR for a narrowly allowlisted low-risk change.

Phase 2 still forbids automatic merge and Production deployment.

Candidate low-risk classes:

- documentation corrections;
- test-only hardening;
- patch-level dependency updates that do not change runtime permissions, network paths, provider routing, auth, persistence, sandboxing, or build/deploy authority.

Every generated Draft PR must include provenance, source URLs, diff summary, risk rationale, tests, rollback instructions, and exact base/head SHAs.

## Phase 3 — LOCKED

A later release may permit automatic merge/deploy only for explicitly allowlisted low-risk classes after a long observation period.

The following remain owner-approval-only even in Phase 3:

- authentication, authorization, identity, session, or account boundaries;
- secrets, key management, retention, privacy, logging, or personal-data handling;
- provider/model/routing/pricing/ZDR policy;
- network egress, URL policy, MCP/connectors, tool permissions, sandboxing;
- database schema or destructive migration;
- GitHub/Vercel/Supabase permissions;
- CI/release/security gate modification;
- self-evolution policy/workflow modification;
- new external service requiring credentials or cost;
- Production rollback policy.

## Source trust model

Tier 1 — authoritative machine/actionable evidence:
- official vendor documentation/changelogs/security advisories;
- package registry metadata;
- GitHub Security Advisories / repository releases;
- NVD/OSV or equivalent vulnerability records;
- official standards bodies.

Tier 2 — discovery only:
- reputable engineering publications and research papers.

Tier 3 — discovery only, never sufficient for an update decision:
- Reddit, Hacker News, social posts, forums, third-party summaries.

A Tier 2/3 claim must be confirmed by Tier 1 evidence before it can become an implementation proposal.

## Decision contract

The judge returns structured findings only. Each finding contains:

- category;
- risk: low / medium / high;
- evidence source;
- affected ORIGIN component;
- reason;
- recommended next action;
- confidence/evidence limitation.

No finding may claim a scan succeeded if a required source failed.

## Source → Sink boundary

Collected text is normalized, bounded, and wrapped as untrusted evidence before ORIGIN sees it.

The Phase 1 sink is GitHub Issues only. There is no code-write or deployment sink in the workflow.

This is intentional defense in depth against indirect prompt injection.

## Kill switch

Setting repository variable `ORIGIN_SELF_UPDATE_DISABLED=true` must prevent the scheduled scan from invoking ORIGIN or creating an Issue.

Manual workflow dispatch remains available for a controlled verification run.

## Audit evidence

Every report records:

- UTC generation time;
- repository and exact SHA;
- scan mode;
- source collection status;
- fixed free model identity and whether it still appears in the public model list;
- npm audit/outdated summary;
- judge status;
- report fingerprint.

Raw secrets and raw upstream/provider error bodies are prohibited.

## Promotion rule

Phase 1 does not automatically promote itself.

Moving to Phase 2 or Phase 3 requires an explicit code change reviewed through the normal release/security gates and owner approval.
