/**
 * Read-only check configuration audit. Run ONLY from a trusted protected
 * environment, never from a PR checkout: its VERCEL_TOKEN is a secret.
 *
 * Vercel config check is necessary but NOT a production release approval.
 * The actual deployment-alias negative-path test, signed Owner approval and
 * live SHA verification are separate, mandatory gates.
 */
import {
  fetchAndAuditOriginVercelChecksV1,
} from "../src/release/OriginProgressiveReleaseVercelCheckAuditV1.js";

async function main(): Promise<void> {
  const token = process.env.VERCEL_TOKEN ?? "";
  const projectId = process.env.VERCEL_PROJECT_ID ?? "";
  const teamId = process.env.VERCEL_ORG_ID ?? "";
  const value = await fetchAndAuditOriginVercelChecksV1({ token, projectId, teamId });
  if (!value.ok) {
    process.stdout.write(JSON.stringify({
      schemaVersion: "origin.vercel-checks-audit.v1",
      configuredBlockingCheckFound: false,
      releaseAuthorized: false,
      blockers: [value.code],
    }) + "\n");
    process.exitCode = 2;
    return;
  }

  process.stdout.write(JSON.stringify(value.audit) + "\n");
  if (!value.audit.configuredBlockingCheckFound || value.audit.blockers.length) {
    process.exitCode = 2;
  }
}

main().catch(() => {
  process.stderr.write("VERCEL_CHECK_READBACK_UNAVAILABLE\n");
  process.exitCode = 2;
});
