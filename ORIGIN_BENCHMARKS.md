# ORIGIN Benchmarks

Status: Persistent benchmark charter for ORIGIN Personal / ACOS.

## 1. Purpose

Benchmarks exist to prove that ORIGIN is improving, not merely changing. Keep a stable core suite so releases can be compared over time, and add temporary probes for new risks and capabilities.

## 2. Core answer benchmark categories

Maintain representative prompts for:

1. Simple factual explanation.
2. Business/marketing strategy.
3. Comparison and recommendation.
4. Quantitative reasoning.
5. Coding/debugging.
6. UI/UX design critique.
7. Document transformation.
8. Long-context synthesis.
9. Ambiguous request handling.
10. Misleading/false-premise resistance.
11. Current-information request.
12. Artifact generation.

Score each relevant run on:

- accuracy,
- completeness,
- relevance,
- usefulness,
- concision,
- structure,
- uncertainty handling,
- hallucination resistance,
- source/evidence quality when applicable,
- latency,
- truncation/repetition.

## 3. Artifact benchmark set

Maintain at least these stable artifact prompts:

### Habit tracker
Create a responsive single-file web app that records and deletes daily habits and updates completion rate in real time.

Verify functionality, responsive layout, visual quality, artifact detection, preview, edit, save, copy, share, and recovery.

### Executive presentation
Create a seven-slide executive presentation for improving new B2B sales.

Verify information hierarchy, visual structure, slide count, readability, mobile preview behavior, and export/save usability supported by the current product.

### Data comparison dashboard
Create a dashboard comparing Company A/B/C revenue, gross margin, and growth.

Verify KPI hierarchy, chart/readability, responsive behavior, and meaningful comparison.

### Premium landing page
Create a premium hotel landing page.

Verify visual originality, typography, layout, responsive quality, accessibility, and production readiness.

### Runtime-error artifact
Create/modify an artifact so a controlled JavaScript runtime error is triggered.

Verify iframe isolation, error detection, parent survival, bounded diagnostics, last-known-good recovery, and post-recovery preview.

## 4. UI / UX benchmark

Regularly inspect at representative widths including mobile, tablet, and desktop. Track:

- task discoverability,
- input usability,
- touch targets,
- keyboard/IME handling,
- reading hierarchy,
- contrast,
- spacing,
- icon consistency,
- artifact workspace usability,
- error recovery,
- history/navigation where available,
- zoom/accessibility behavior.

## 5. Performance benchmark

Track when tooling permits:

- request start -> first meaningful answer,
- request start -> completion,
- artifact detected -> workspace open,
- workspace open -> preview ready,
- LCP,
- INP,
- CLS,
- API latency,
- server/provider latency,
- JS bundle impact.

Report median, P75, P95, and worst sample where sample size supports it.

## 6. Security benchmark

Maintain regression tests or manual probes covering:

- localStorage/sessionStorage access from artifact,
- cookie access,
- IndexedDB,
- fetch/XHR/WebSocket/EventSource escape,
- external image/media loads,
- window.open,
- navigation/top navigation,
- form submission,
- meta refresh,
- nested frames,
- workers/service workers,
- parent DOM access,
- postMessage spoofing/source validation,
- runtime-error payload bounding,
- top-level security headers,
- zero-cost/model-routing fail-closed behavior.

Where possible, prove both attack-code execution and absence of prohibited outbound effects.

## 7. Competitive intelligence benchmark

At meaningful release milestones and periodically, review current primary-source product updates from leading AI and software products.

Candidate comparison set includes ChatGPT/OpenAI, Claude/Anthropic, Gemini/Google, Grok/xAI, Perplexity, Microsoft Copilot, Vercel/v0, Linear, Notion, Apple platform UX, and other products that become materially relevant.

Do not ask only "does competitor X have feature Y?" Evaluate:

- what user problem it solves,
- whether users gain speed/clarity/trust,
- whether ORIGIN already solves it,
- whether the pattern fits ORIGIN's philosophy,
- adoption cost/risk,
- measurable success criteria.

Current information must be verified from recent trustworthy sources, preferably first-party release notes/documentation. Record the observation date.

## 8. External AI audit matrix

Use specialist reviews after material changes:

- ChatGPT: architecture, integrated product UX, security, code/system consistency.
- Claude: long-context contradictions, edge cases, failure modes, content/information architecture.
- Gemini: Android/mobile, responsive design, accessibility, visual system, web/platform behavior.
- Grok: adversarial/red-team critique, competitive weakness, failure assumptions.

The Responsible AI synthesizes evidence; it does not decide by majority vote.

## 9. Regression rule

A change is not a net improvement if it gains one metric by materially damaging another critical dimension. Explicitly check common tradeoffs:

- faster but less accurate,
- safer but artifacts unusable,
- prettier but harder to operate,
- mobile improvement with desktop regression,
- more detailed but slower/repetitive,
- new capability with higher cost or weaker privacy/security.

## 10. Benchmark records

For each formal benchmark run, record when practical:

- date/time and timezone,
- production URL/release SHA,
- benchmark version,
- environment/device/viewport,
- prompt/test ID,
- measured output/result,
- PASS/CONDITIONAL PASS/FAIL/UNVERIFIED,
- observed regression or improvement,
- follow-up P0/P1/P2/P3 items.

The benchmark definition should persist even when the Responsible AI changes, so longitudinal comparisons remain meaningful.
