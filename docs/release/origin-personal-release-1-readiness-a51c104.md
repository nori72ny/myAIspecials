# ORIGIN Personal Release 1 Readiness Evidence

Exact base main SHA: `a51c104429381011f920474cafdccdbae0c0f28c`

Date checked: 2026-07-31 JST

Expected and actual cost for this evidence pass: `$0.00`

## Scope

This evidence records the current state for the first daily-use ORIGIN Personal release candidate. It does not deploy the application, change runtime credentials, change account or billing settings, or enable paid services.

## Local validation executed

Environment:

- Node.js: `v24.14.0`
- npm: `11.9.0`
- Repository state: latest `main` at `a51c104429381011f920474cafdccdbae0c0f28c`

Executed checks:

- `npm ci --cache /tmp/origin-npm-cache`: PASS
- `npm run lint`: PASS
  - TypeScript `tsc --noEmit`: PASS
  - design-token lock: PASS
- `npm test`: PASS
  - 66 test files passed
  - 771 tests passed
- `npm run test:api`: PASS
  - 5 tests passed
  - 1 test skipped
- `npm run build`: PASS

## Local HTTP smoke checks

Built server was started in production mode and exercised through HTTP.

Observed results:

- `GET /health`: 200 OK, `{ "status": "ok", "service": "acos-2" }`
- `GET /`: 200 OK, Japanese document boundary and `ORIGIN Personal` title served
- `POST /api/chat` with `AIO対策について教えて`: 200 OK, no external AI execution; response states live search is not connected and refuses to answer from possibly stale knowledge
- `POST /api/chat` with `今日の予定を整理してください`: 503, `FREE_PROVIDER_NOT_CONFIGURED`, retryable false
- `POST /api/chat` with a synthetic provider-key-like value: 422, `SENSITIVE_INPUT_BLOCKED`, retryable false, category only
- `POST /api/chat` with `大阪の天気を教えて`: 200 OK, no external AI execution; response states weather service is not connected
- `POST /api/chat` with `天気を教えて`: 200 OK, asks which location to check and does not call external AI

## GitHub Actions status

No PR-associated GitHub Actions runs were found for exact main SHA `a51c104429381011f920474cafdccdbae0c0f28c` before this evidence PR.

This Draft PR exists to obtain GitHub Actions evidence for a candidate derived from that latest main SHA. The resulting PR SHA must pass the required workflows before release readiness is upgraded.

## Current release-readiness judgment

Current status: `CONDITIONAL / NOT YET DEPLOYABLE`

No current P0/P1 blocker was found in local validation. The candidate is not yet a daily-use public release because production deployment and live production verification remain unapproved and unexecuted.

## Remaining blockers before first public daily-use release

- GitHub Actions must pass for this exact evidence PR head SHA.
- Deployment requires separate explicit owner approval.
- No deployment was performed by this evidence pass.
- Production smoke verification on the public URL has not been executed.
- Live provider execution with actual cost `$0.00` has not been verified in production.
- Live source retrieval and source-content verification remain disconnected.
- Independent second-provider review remains disconnected.
- AI Studio direct runtime remains outside release 1 and must not be presented as active.

## Required release boundary

The first release remains limited to:

- ORIGIN Personal
- Settings
- server-enforced free-only execution
- OpenRouter `:free` only when configured and verified
- no paid fallback
- no automatic provider switching to paid services
- no Project or Personal Memory feature exposure as implemented capabilities
- no claim of live search, source-content verification, independent AI review, or AI Studio direct runtime until those paths are connected and verified

## Merge and deployment state

- Merge performed by this evidence pass: no
- Deployment performed by this evidence pass: no
- Billing/account/DNS/cloud/repository settings changed: no
- Secrets requested, displayed, or used: no
- Paid model/API/service used: no
