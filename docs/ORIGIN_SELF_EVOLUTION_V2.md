# ORIGIN Self-Evolution V2 — World Model Policy

## North star

ORIGIN does not start from "follow the world." ORIGIN starts from its own verified best-known capability baseline and continuously searches for evidence that can make that baseline stronger.

External information is an observation stream, not authority. No external source may directly change code, models, permissions, secrets, security controls, release gates, or Production.

## Permanent objectives

ORIGIN continuously evaluates improvement opportunities across:
- answer quality and reasoning;
- grounded research and retrieval;
- coding and software engineering;
- general agent planning, execution, recovery, and tool use;
- image generation, editing, multimodal understanding, and visual quality;
- artifacts, documents, spreadsheets, slides, web/app generation;
- UI/UX, typography, accessibility, interaction design, and product ergonomics;
- security, supply-chain risk, vulnerabilities, abuse resistance, sandboxing, and privacy;
- infrastructure, runtime, server, database, networking, observability, reliability, and performance;
- model/provider capability, free-tier durability, latency, context, tool use, and policy changes;
- standards, protocols, browser/platform changes, and emerging research.

## World-model loop

1. Observe — collect bounded evidence from authoritative, research, ecosystem, incident, and discovery sources.
2. Normalize — convert observations into source-addressed facts with timestamps, fingerprints, confidence, and provenance.
3. Compare — compare each observation with ORIGIN's verified current baseline and known gaps.
4. Challenge — ask whether ORIGIN is already better, merely different, or genuinely behind on a measurable axis.
5. Propose — create a bounded improvement hypothesis with expected benefit, risk, cost, affected components, and acceptance tests.
6. Experiment — only on an isolated branch/sandbox. Never directly on Production.
7. Verify — require deterministic tests plus relevant E2E, security, accessibility, performance, and quality comparison.
8. Promote — only when evidence demonstrates no regression and a real improvement.
9. Retain — keep provenance, exact base/head SHA, measurements, rollback path, and rejected hypotheses.
10. Repeat — continue observation after promotion; no capability is considered permanently optimal.

## Information hierarchy

Tier A — implementation-grade primary evidence: official specifications, documentation, changelogs, advisories, repositories, releases, model cards, pricing/privacy pages, CVEs, standards bodies, package registries.

Tier B — research-grade evidence: peer-reviewed papers, arXiv/major conference publications, reproducible benchmarks, respected engineering research.

Tier C — ecosystem evidence: high-quality engineering posts, public incident reports, issue trackers, benchmark repositories, practitioner write-ups.

Tier D — discovery signals: community discussions, social posts, aggregators, trend pages, demos, user feedback.

Tier D can trigger investigation only. Tier C normally requires confirmation. Security/provider/cost/privacy changes require Tier A evidence.

## Improvement scoring

Each improvement candidate is scored for user value, correctness/quality gain, security, reliability, latency/performance, accessibility/UX, reversibility, evidence strength, implementation complexity, and USD cost impact.

A candidate that weakens the permanent USD 0 boundary, introduces paid fallback, requires a credit card, weakens secrets handling, broadens privileges, or bypasses evaluation is rejected unless the owner explicitly changes that invariant.

## Automation authority

Automatic: read public sources; collect repository/runtime evidence; fingerprint and deduplicate observations; create sanitized findings; open/update Issues; run non-destructive experiments on isolated branches; create Draft PRs for allowlisted low-risk changes.

Never automatic: merge to main while an evaluation freeze is active; modify secrets/credentials; enable paid providers/billing; expand permissions/egress; relax security/privacy/held-out/release gates; switch production models/providers without qualification; deploy a high-risk change; self-modify this authority boundary.

## Baseline principle

The comparison target is always the exact current verified ORIGIN baseline, not a stale competitor snapshot. External systems are challenge evidence. ORIGIN may adopt, reject, combine, or exceed outside ideas, but promotion requires reproducible proof of improvement.

## Fail-closed rules

Missing evidence is NOT_MEASURED. A source outage is not "no change." A green workflow is not quality proof. A newer version is not automatically better. A benchmark seen by engineering is not a valid final held-out. No result may claim superiority without controlled comparative evidence.
