# Agentic Coding OS Phase 2 Follow-up Audit

## Verified

- Preview deployment for commit `e1043097c975e4c82c62e93f2b8e81c5e408636b` reached `READY`.
- `/api/health` returned HTTP 200 and reported the same release SHA.
- The previous `OriginExecutionPolicy.ts` TypeScript error was reproduced in Vercel build logs and then removed on a later build.
- The obsolete `replacement.txt` artifact containing paid-provider/OpenAI code was removed.
- The stale `tsc_output.txt` generated artifact was removed.
- Provider-specific free evidence is now explicitly bound to provider identity; mismatched evidence has a deterministic regression test.
- The current default OpenRouter evidence remains expired and therefore continues to fail closed rather than being silently refreshed.
- Production runtime error logs for the last 24 hours were empty at the time of this audit.

## P1 remediation applied

The legacy `services/mission-engine/src/application/agent/ToolExecutor.ts` `FileTool` is now **read-only**. Its previous direct `fs.mkdir` + `fs.writeFile` write primitive has been removed and replaced with an explicit `LEGACY_FILE_WRITE_DISABLED` fail-closed result. Repository writes remain centralized in the hardened `src/agent/safeRepositoryWriter.ts` boundary.

The legacy read path was also hardened with protected-path filtering, repository-root resolution, intermediate symlink rejection, `O_NOFOLLOW`, and a bounded 2 MiB read limit.

Regression coverage was added in `services/mission-engine/src/__tests__/ToolExecutorSecurity.test.ts` for:

1. legacy writes being blocked without filesystem mutation;
2. traversal/protected-path reads being blocked;
3. intermediate-symlink escape attempts being rejected.

## Final gates still required

- Re-run typecheck and the complete unit suite on the new HEAD.
- Re-run production build and serverless/runtime smoke tests.
- Obtain a successful Vercel deployment for the final HEAD after the previous build-rate-limit window clears.
- Re-run the final free-provider evidence/security audit.

The previous deployment attempt was blocked by Vercel's `api-deployments-free-per-day` limit. The documented 24-hour window has now elapsed; a fresh final-HEAD deployment is the next verification gate. A prior READY preview is not reused as evidence for the final commit.

No production merge or readiness claim is made until all final gates pass on the same final commit.
