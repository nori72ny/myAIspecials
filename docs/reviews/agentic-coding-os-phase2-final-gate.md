# Agentic Coding OS Phase 2 Final Gate

Final HEAD: `06bfd047d3d2f887bdd4daf944fcad126f8be296`

## Security remediation

- Legacy mission-engine `FileTool` repository writes are disabled with `LEGACY_FILE_WRITE_DISABLED`.
- Legacy reads use repository-root resolution, protected-path filtering, intermediate symlink rejection, `O_NOFOLLOW`, and a 2 MiB read limit.
- Current `src/agent/toolRegistry.ts` routes repository writes through `safeRepositoryWriter.ts` only.
- Regression coverage exists for legacy write blocking, traversal/protected paths, and intermediate symlink escape.
- CodeQL previously flagged check/use filesystem race patterns in repository exploration/editor/reader paths; the current implementation adds descriptor-based reads and `O_NOFOLLOW`, but this remains an audit item until current-head CI/CodeQL evidence is refreshed.

## Deployment verification

- Previous exact final-head preview deployment `dpl_C6i7LSmR2mP8kYoZvcDf9dXYNA6K` was `READY` for `08e6b44...`; `/api/health` returned HTTP 200 with the matching release SHA and no checked error/fatal runtime logs.
- The protected preview `/api/chat` endpoint redirected to Vercel SSO during external probing, so actual chat execution was not claimed as verified.
- The current head is `06bfd047d3d2f887bdd4daf944fcad126f8be296`; a new exact-head deployment is required before treating deployment evidence as current.

## CI verification

- The ACOS Quality Gate workflow is configured for PRs targeting `main`, manual dispatch, and now an exact `feat/agentic-coding-os-phase2` push trigger so branch-head evidence can be collected without depending on a stale PR merge ref.
- The latest observed PR ACOS run used merge ref `3f1a1b9...` based on older head `1ea841c...` and failed during `npm ci` because that historical checkout requested `@types/jest@^30.0.2`.
- The current branch head's `package.json` and lockfile request `@types/jest@^30.0.0`; the historical ETARGET failure is therefore not treated as current-head code evidence.
- Current-head GitHub Actions completion remains unverified until a run executes against `06bfd047d3d2f887bdd4daf944fcad126f8be296`.

## Merge gate

Do not merge or promote to production until the same current HEAD receives:

1. successful typecheck;
2. successful complete unit suite;
3. successful production build/serverless runtime checks;
4. successful exact-head Vercel deployment;
5. `/api/health` and relevant `/api/chat` runtime smoke verification, or a documented protected-preview limitation plus equivalent authenticated verification;
6. current zero-cost/provider-evidence/security audit;
7. refreshed CodeQL/CI evidence with no untriaged blocking findings.

The gate remains open. No production promotion or merge is claimed.
