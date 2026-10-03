# ORIGIN Frontier Current Status

This file records the current evidence interpretation rules for ORIGIN frontier qualification. It does not claim superiority over external systems.

## Current exact-main baseline

Candidate SHA at creation: `370ea4d43bfe9bd1a51e34533f70f64a25937cb6`.

## Domain interpretation

- Answer / response quality: `NOT_MEASURED` until fresh exact-current-SHA absolute and blind comparative AQ V2 evidence exists.
- Coding: `NOT_MEASURED` unless the final held-out run preserves an `origin-held-out-final-evidence-*` artifact for the exact candidate SHA and the qualification workflow completes successfully.
- General Agent: `NOT_MEASURED` until fresh exact-current-SHA private execution and trusted comparison evidence exists.
- Image: `NOT_MEASURED` until fresh exact-current-SHA private candidate and blind comparison evidence exists.
- Artifact: `NOT_MEASURED` until fresh exact-current-SHA private candidate and blind comparison evidence exists.
- Product / release quality: normal CI/security/browser/Production verification may be GREEN independently of frontier qualification.

## Important distinction

A GitHub Actions workflow conclusion of `success` is not by itself frontier qualification. In particular, the V1.4 final held-out coding workflow may complete successfully after a safe preflight-only skip when sealed corpus prerequisites are unavailable. Such a run is `NOT_MEASURED`, not `QUALIFIED`.

The `Frontier coding qualification status audit` workflow turns that distinction into a machine-readable artifact after each completed final held-out coding run.

## Continuation checkpoint — 2026-10-03

Production `/api/health` was rechecked at main `e03484f79d42327cc7c195cf90c7ce9ca7180fa3`: status ok, freeOnly true, paidFallbackEnabled false, server-only secrets. Production Release CI/CD run 37094418211 succeeded. This does not supply fresh independent domain qualification.

Follow-up audit repair distinguishes interrupted/failed evaluation from safe preflight-only skips, excludes expired evidence, and rejects incomplete artifact inventories. Next: exact-head CI for this repair, followed by fresh-domain evaluation prerequisite verification without consuming or reusing sealed corpora.
