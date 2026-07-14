# ACOS 2.0 Deployment Runbook

## Release policy

Production deployment is a separate, explicit operation from merging to `main`. A merge must not automatically publish to production.

This project has a strict zero-cost policy. OpenRouter is the primary external AI gateway, and only model IDs explicitly marked as free may be used. Automatic routing and paid provider credentials are prohibited in staging and production.

## Required gates

Deploy only when all of the following are true for the exact release commit:

1. Production Release CI/CD is successful.
2. ACOS 2.0 Quality Gate is successful.
3. CodeQL and OpenSSF Scorecard are successful.
4. Dependency Review is successful.
5. Node.js 22 and 24 jobs pass lint, build, unit, API, E2E, Lighthouse, evidence generation, and SBOM generation.
6. There are no unresolved P1 review findings.
7. `OPENROUTER_API_KEY` is configured outside the repository.
8. `FREE_ONLY=true` is present in staging and production.
9. Direct provider keys such as `GEMINI_API_KEY`, `OPENAI_API_KEY`, and `ANTHROPIC_API_KEY` are unset.
10. Every configured OpenRouter model ID is explicitly free, such as an ID ending in `:free`; `openrouter/auto` is not allowed.
11. The hosting tier, database, Redis, logging, and monitoring configuration have been checked for charges, trials, or automatic paid upgrades.
12. A rollback target is identified before deployment.

## Recommended sequence

1. Create an immutable release candidate tag from the validated `main` commit.
2. Build the production image from that tag.
3. Deploy the same image to a no-cost staging environment.
4. Verify at startup that `FREE_ONLY=true` and that no direct paid-provider credentials are present.
5. Run smoke tests for startup, dashboard, Unified Chat, settings, provider configuration errors, mission execution, free-model rejection, and OpenRouter rate-limit handling.
6. Confirm from logs or OpenRouter activity that requests use only explicit `:free` models.
7. Observe staging logs, error rates, and external-provider behavior for at least 30 minutes.
8. Promote the exact same image digest to production during a staffed change window.
9. Run production smoke tests immediately after promotion.
10. Keep the previous image available for immediate rollback.

## Zero-cost operating rules

- Do not configure billing-enabled provider keys.
- Do not use OpenRouter Auto or any model without an explicit free designation.
- Treat free-model unavailability or rate limiting as a service-degradation event; do not fall back to a paid model.
- Prefer a clear temporary-unavailable response over an unexpected charge.
- Configure usage alerts and spending limits at zero wherever the provider or host supports them.
- Re-check free-tier terms before each production release because provider availability and limits can change.

## Preferred production window

Use a low-traffic period when the owner can actively monitor the system for at least 60 minutes after release. Avoid deploying immediately before sleep, travel, or any period without access to logs and rollback controls.

## Initial release recommendation

For the first production deployment, use a canary or limited-access release rather than exposing all users immediately. Expand traffic only after the core flows and the OpenRouter free-only integration are confirmed with real production credentials.

## Rollback triggers

Rollback immediately when any of the following occurs:

- Application startup or health verification fails.
- OpenRouter configuration is broken.
- A request attempts to use an automatic or non-free model.
- Any provider or hosting service reports billable usage.
- Mission execution stalls or returns incomplete state.
- Error rate or latency rises materially above the staging baseline.
- Secrets or permissions behave unexpectedly.