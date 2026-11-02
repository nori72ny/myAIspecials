/**
 * PROTECTED-ENV ONLY. READ-ONLY. Never invoke from an untrusted PR checkout
 * with VERCEL_TOKEN: PR code may be attacker controlled.
 *
 * Pre-push snapshot and reviewed script must be pinned by an independent
 * protected operator, not copied from a candidate PR description.
 *
 * This audit cannot grant authorization or replace native Vercel auto-alias
 * prevention. Any missing/stale/mismatched evidence is a blocking failure.
 */
import { fetchAndAuditOriginProtectedProductionAliasesV1 } from
  '../src/release/OriginProtectedProductionAliasesAuditV1.js';

async function main(): Promise<void> {
  let snapshot: unknown = null;
  try {
    snapshot = JSON.parse(process.env.ORIGIN_APPROVED_ALIAS_SNAPSHOT_JSON ?? '');
  } catch {
    // Never print the snapshot, which is sensitive release configuration.
  }
  const report = await fetchAndAuditOriginProtectedProductionAliasesV1({
    token: process.env.VERCEL_TOKEN ?? '',
    teamId: process.env.VERCEL_ORG_ID ?? '',
    projectId: process.env.VERCEL_PROJECT_ID ?? '',
    snapshot,
  });
  process.stdout.write(JSON.stringify(report) + '\n');
  // Even when aliases currently match, this tool NEVER approves publication;
  // exit success means ONLY the old approved alias snapshot is still held.
  if (!report.allProtectedProductionAliasesHeld) process.exitCode = 2;
}
main().catch(() => {
  process.stderr.write('VERCEL_PROTECTED_ALIAS_READBACK_UNAVAILABLE\n');
  process.exitCode = 2;
});
