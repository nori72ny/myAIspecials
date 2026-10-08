/**
 * Defence in depth for the original main-only, budgeted 40-case public AQ
 * benchmark. NEVER extend the GitHub job to a PR checkout: the process
 * ultimately spawns benchmark servers and cannot isolate a provider credential
 * from unreviewed code. A protected, separately-owned provider proxy is
 * required for premerge actual-model evaluation.
 *
 * Environment values are not themselves an authentication boundary. This
 * guard makes accidental PR-SHA dispatch fail closed, but MUST NOT be used
 * as evidence that running arbitrary candidate code with a key is safe.
 */
export const ORIGIN_AQ_FROZEN_BASELINE_SHA =
  "f0c1bff22d3246d3eac3903b9def5d3aa7c1e498";
const TRUSTED_REPOSITORY = "nori72ny/myAIspecials";
const SECRET_ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "POSTGRES_URL",
  "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "VERCEL_TOKEN",
] as const;
const SHA40 = /^[a-f0-9]{40}$/;

export type OriginAqCredentialGuardInput = {
  readonly baselineSha: string;
  readonly candidateSha: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

export type OriginAqCredentialGuardVerdict =
  | { readonly ok: true; readonly hasLiveProviderKey: boolean }
  | { readonly ok: false; readonly code: "AQ_CREDENTIAL_GUARD_UNTRUSTED_EXECUTION" | "AQ_CREDENTIAL_GUARD_ALTERNATE_PROVIDER_BLOCKED" };

/**
 * This existing legacy comparison passes env to subprocess servers.
 * Fail closed when any inherited credential could reach an arbitrary PR head.
 * Production workflows run the fixed, trusted main candidate only.
 */
export function checkOriginAqCredentialBoundary(
  input: OriginAqCredentialGuardInput,
): OriginAqCredentialGuardVerdict {
  const { env, baselineSha, candidateSha } = input;
  const hasLiveProviderKey = Boolean(env.OPENROUTER_API_KEY?.trim());
  const hasAnySensitiveEnvironment = SECRET_ENV_KEYS.some(key => Boolean(env[key]?.trim()));
  if (!hasAnySensitiveEnvironment) {
    return { ok: true, hasLiveProviderKey: false };
  }

  const trustedMain =
    SHA40.test(candidateSha)
    && baselineSha === ORIGIN_AQ_FROZEN_BASELINE_SHA
    && candidateSha !== baselineSha
    && env.GITHUB_ACTIONS === "true"
    && env.GITHUB_REPOSITORY === TRUSTED_REPOSITORY
    && env.GITHUB_REF === "refs/heads/main"
    && (env.GITHUB_EVENT_NAME === "schedule" || env.GITHUB_EVENT_NAME === "workflow_dispatch")
    && env.GITHUB_SHA === candidateSha
    && env.GITHUB_WORKFLOW === "Q1 final AQ scheduled";
  if (!trustedMain) {
    return { ok: false, code: "AQ_CREDENTIAL_GUARD_UNTRUSTED_EXECUTION" };
  }

  if (
    !hasLiveProviderKey
    || SECRET_ENV_KEYS.some(key => key !== "OPENROUTER_API_KEY" && Boolean(env[key]?.trim()))
  ) {
    return { ok: false, code: "AQ_CREDENTIAL_GUARD_ALTERNATE_PROVIDER_BLOCKED" };
  }
  return { ok: true, hasLiveProviderKey: true };
}

/** The legacy benchmark runs both server processes in the trusted job.
 * Never forward arbitrary GitHub, DB, cloud, or application env variables
 * to their build or runtime; permit only the single reviewed free provider key
 * for runtime, and never for a build. This is not an isolation boundary for
 * arbitrary PR code and must not be used to authorize a premerge evaluation.
 */
export function createOriginAqChildEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  target: { readonly sha: string; readonly phase: "build" | "runtime"; readonly port?: number },
): NodeJS.ProcessEnv {
  if (!SHA40.test(target.sha)
    || (target.phase === "runtime" && (!Number.isInteger(target.port) || Number(target.port) < 1024 || Number(target.port) > 65535))
    || (target.phase === "build" && target.port !== undefined)) {
    throw new Error("AQ_CHILD_ENV_TARGET_INVALID");
  }
  const clean: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    ORIGIN_RELEASE_SHA: target.sha,
  };
  // Fixed allowlist excludes sensitive CI or customer credentials by default.
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "CI"] as const) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) clean[key] = value;
  }
  if (target.phase === "runtime") {
    clean.PORT = String(target.port);
    if (typeof source.OPENROUTER_API_KEY === "string" && source.OPENROUTER_API_KEY.length > 0) {
      clean.OPENROUTER_API_KEY = source.OPENROUTER_API_KEY;
    }
  }
  return clean;
}
