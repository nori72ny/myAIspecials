# ACOS 2.0 Deployment Runbook

## Release policy

Production deployment is a separate, explicit operation from merging to `main`. A merge must not automatically publish to production.

## Required gates

Deploy only when all of the following are true for the exact release commit:

1. Production Release CI/CD is successful.
2. ACOS 2.0 Quality Gate is successful.
3. CodeQL and OpenSSF Scorecard are successful.
4. Dependency Review is successful.
5. Node.js 22 and 24 jobs pass lint, build, unit, API, E2E, Lighthouse, evidence generation, and SBOM generation.
6. There are no unresolved P1 review findings.
7. Required production secrets are configured outside the repository.
8. A rollback target is identified before deployment.

## Recommended sequence

1. Create an immutable release candidate tag from the validated `main` commit.
2. Build the production image from that tag.
3. Deploy the same image to staging.
4. Run smoke tests for startup, dashboard, Unified Chat, settings, provider configuration errors, and mission execution.
5. Observe staging logs and error rates for at least 30 minutes.
6. Promote the exact same image digest to production during a staffed change window.
7. Run production smoke tests immediately after promotion.
8. Keep the previous image available for immediate rollback.

## Preferred production window

Use a low-traffic period when the owner can actively monitor the system for at least 60 minutes after release. Avoid deploying immediately before sleep, travel, or any period without access to logs and rollback controls.

## Initial release recommendation

For the first production deployment, use a canary or limited-access release rather than exposing all users immediately. Expand traffic only after the core flows and external AI-provider integrations are confirmed with real production credentials.

## Rollback triggers

Rollback immediately when any of the following occurs:

- Application startup or health verification fails.
- Authentication or provider configuration is broken.
- Mission execution stalls or returns incomplete state.
- Error rate or latency rises materially above the staging baseline.
- Secrets, permissions, or paid-model constraints behave unexpectedly.
