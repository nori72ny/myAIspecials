# Agentic Coding OS Phase 2 Final Gate

Final HEAD: `08e6b44ab31751a452c3531b42cc7614b1eb6def`

## Security remediation

- Legacy mission-engine `FileTool` repository writes are disabled with `LEGACY_FILE_WRITE_DISABLED`.
- Legacy reads use repository-root resolution, protected-path filtering, intermediate symlink rejection, `O_NOFOLLOW`, and a 2 MiB read limit.
- Current `src/agent/toolRegistry.ts` routes repository writes through `safeRepositoryWriter.ts` only.
- Regression coverage exists for legacy write blocking, traversal/protected paths, and intermediate symlink escape.
- CodeQL previously flagged check/use filesystem race patterns in repository exploration/editor/reader paths; the current implementation adds descriptor-based reads and `O_NOFOLLOW`, but this remains an audit item until the current-head CI/CodeQL evidence is refreshed.

## Deployment verification

- Exact final-head preview deployment: `dpl_C6i7LSmR2mP8kYoZvcDf9dXYNA6K`.
- The deployment is `READY` and is built from `08e6b44ab31751a452c3531b42cc7614b1eb6def` on `feat/agentic-coding-os-phase2`.
- `/api/health` returned HTTP 200 with the matching release SHA.
- No error/fatal runtime logs were present for the exact deployment in the checked preview window.
- The protected preview `/api/chat` endpoint redirected to Vercel SSO during external probing, so actual chat execution is not claimed as verified by this gate.
- Vercel's current deployment status is successful; the GitHub commit status for this exact SHA reports `success` for the Vercel deployment.

## CI verification

- The repository CI workflow is configured for pull requests targeting `main` and for pushes to `main`.
- The latest previously observed ACOS run was against an older PR merge ref and failed during `npm ci` because that historical checkout requested `@types/jest@^30.0.2`.
- The current final head's `package.json` and lockfile request `@types/jest@^30.0.0`; therefore the historical failure is not treated as current-head evidence.
- Current-head GitHub Actions completion remains unverified until a run against `08e6b44ab31751a452c3531b42cc7614b1eb6def` completes.

## Merge gate

Do not merge or promote to production until the same final HEAD receives:

1. successful typecheck;
2. successful complete unit suite;
3. successful production build/serverless runtime checks;
4. successful Vercel deployment for `08e6b44ab31751a452c3531b42cc7614b1eb6def`;
5. `/api/health` and relevant `/api/chat` runtime smoke verification on that deployment, or a documented protected-preview limitation plus equivalent authenticated verification;
6. current zero-cost/provider-evidence/security audit;
7. refreshed CodeQL/CI evidence with no untriaged blocking findings.

The deployment gate is currently green for Vercel, but the overall merge gate remains open until CI/security/runtime evidence is refreshed against the exact final HEAD.
