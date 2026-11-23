# ORIGIN Competitive Benchmark v1

## Purpose

Measure ORIGIN against ChatGPT (including available Astra/agent experiences), Claude Code, and Gemini using reproducible tasks. Do not claim superiority without comparable evidence. Separate model quality from product/workflow quality.

## Non-negotiable constraints

- Operating and evaluation budget: USD $0.00 unless the owner separately authorizes a different budget for a specific test.
- No paid API calls, automatic paid fallback, provider-triggered billing, or credential changes.
- Do not run external inference as part of CI. CI validates benchmark schemas, scoring, policy enforcement, and deterministic fixtures only.
- Never put API keys, private corpus contents, account IDs, or other secrets in evidence bundles.
- Mark unavailable products, models, or features as NOT RUN; never substitute fabricated scores.
- Keep production changes, merges, and deployments behind their existing explicit approval gates.

## Systems under comparison

1. ORIGIN Personal: exact commit SHA, UI build, configured free-only model/provider, and enabled tools recorded.
2. ChatGPT: exact product surface and model label recorded at test time; Astra/agent experience is a separate row when available.
3. Claude Code: exact CLI/product version and model label recorded.
4. Gemini: exact product surface and model label recorded; web app and coding/agent tooling are separate rows when materially different.

A product name alone is not a reproducible model identifier. Record date, plan/access tier, model label shown by the product, tool permissions, internet access, context provided, and whether the task used an interactive UI or API. Do not assume paid and free tiers are equivalent.

## Task suite

Use a fixed, versioned, held-out suite with at least 30 tasks per release candidate, balanced across:

- Japanese and English reasoning / factual synthesis (6)
- Code comprehension, bug diagnosis, patch quality, regression tests (6)
- Multi-step agent workflows with explicit success criteria (6)
- Document and structured-artifact creation (4)
- Image understanding / generation / editing, where the product actually supports it (4)
- Mobile UX, accessibility, and task completion (4)

Tasks must include expected outcomes, prohibited behaviors, a deterministic scoring rubric, and failure conditions. Keep a private held-out subset to reduce benchmark overfitting. Use the same prompt, input files, constraints, and time budget where the product surfaces permit it. When surfaces differ, label the comparison as product-level rather than model-only.

## Scoring

Score each task from 0–5 on each applicable dimension:

- Correctness and evidence (30%)
- Instruction adherence and completeness (20%)
- Artifact / code quality (20%)
- Robustness, recovery, and honest uncertainty (15%)
- Usability and clarity (10%)
- Efficiency (5%)

For coding tasks, correctness is gated by tests; a plausible explanation without a working patch cannot receive full credit. For image tasks, evaluate the actual returned image/artifact, not a procedural placeholder or a text description. Score factual claims against the task's answer key or cited sources. Report task-level scores and confidence intervals; do not rely only on one aggregate score.

## Required report fields

- Benchmark version and task-set hash
- Candidate commit SHA and test run timestamp
- Product surface, model label/version, plan/tier, and available tools
- Exact prompts and input artifact hashes (redact private held-out content)
- Per-task rubric scores, pass/fail, elapsed time, retries, and failure category
- Verified direct cost, or UNKNOWN when it cannot be independently established
- Missing capabilities / not-run reasons
- Aggregate scores by category and uncertainty range
- Reviewer notes and reproducibility instructions

## Decision gates

- Do not publish a winner from unequal task sets or incomparable product surfaces.
- Do not mark cost as $0.00 merely because no price was displayed. Require a verifiable free entitlement/usage record or a deterministic local-only test.
- Do not treat static tests, mocks, or provider status endpoints as proof that live image generation works.
- Report results as CODE-PROVEN, TEST-COVERED, EXECUTED, or UNVERIFIED.
- Improvement is accepted only when it raises a measured category without regressing security, accessibility, cost policy, or reliability gates.

## Existing ORIGIN evaluation entry points

The repository already exposes evaluation commands for Claude Code parity, held-out coding comparisons, trusted general-agent comparisons, image blind quality, and trusted-answer quality. Inspect each command's input schema and evidence provenance before reusing it. Existing evaluators do not by themselves prove that a competitor was actually run; evidence must be tied to an observed execution and exact candidate SHA.

## Initial execution plan

1. Stabilize the current image-provider diagnostics and free-only gate with CI; do not merge automatically.
2. Audit existing evaluators and their input types for fabricated, stale, or unbound evidence.
3. Add schema validation for a unified benchmark manifest and evidence bundle, including exact candidate SHA and execution provenance.
4. Run deterministic local tests in CI; keep all live competitor runs manual and outside CI.
5. Publish the first report only after genuine comparable runs exist. Until then, benchmark status is DESIGN_READY / NOT_YET_EXECUTED, not a performance claim.
