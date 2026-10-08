import { describe, expect, it } from "vitest";
import {
  checkOriginAqCredentialBoundary,
  ORIGIN_AQ_FROZEN_BASELINE_SHA,
} from "./aq-provider-credential-guard.js";

const candidateSha = "b".repeat(40);
const trusted = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "nori72ny/myAIspecials",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "schedule",
  GITHUB_WORKFLOW: "Q1 final AQ scheduled",
  GITHUB_SHA: candidateSha,
  OPENROUTER_API_KEY: "fixture-not-a-key",
};

const check = (env: Readonly<Record<string, string | undefined>>, options: {
  baselineSha?: string;
  candidateSha?: string;
} = {}) => checkOriginAqCredentialBoundary({
  env,
  baselineSha: options.baselineSha ?? ORIGIN_AQ_FROZEN_BASELINE_SHA,
  candidateSha: options.candidateSha ?? candidateSha,
});

describe("public AQ benchmark inherited-secret boundary", () => {
  it("permits only the pinned same-repo scheduled main and exact candidate SHA", () => {
    expect(check(trusted)).toEqual({ ok: true, hasLiveProviderKey: true });
    expect(check({ ...trusted, GITHUB_EVENT_NAME: "workflow_dispatch" }))
      .toEqual({ ok: true, hasLiveProviderKey: true });
  });

  it.each([
    ["pull request event", { GITHUB_EVENT_NAME: "pull_request" }],
    ["PR ref", { GITHUB_REF: "refs/pull/930/merge" }],
    ["forked repository", { GITHUB_REPOSITORY: "somebody/other" }],
    ["different candidate HEAD", { GITHUB_SHA: "c".repeat(40) }],
    ["spoofed workflow", { GITHUB_WORKFLOW: "untrusted-aq" }],
    ["local terminal", { GITHUB_ACTIONS: "false" }],
  ])("blocks inherited credential exposure in %s", (_, changed) => {
    expect(check({ ...trusted, ...changed }))
      .toEqual({ ok: false, code: "AQ_CREDENTIAL_GUARD_UNTRUSTED_EXECUTION" });
  });

  it("rejects the frozen baseline as the candidate", () => {
    expect(check({ ...trusted, GITHUB_SHA: ORIGIN_AQ_FROZEN_BASELINE_SHA }, {
      candidateSha: ORIGIN_AQ_FROZEN_BASELINE_SHA,
    })).toEqual({ ok: false, code: "AQ_CREDENTIAL_GUARD_UNTRUSTED_EXECUTION" });
  });

  it("rejects modified pinned baseline", () => {
    expect(check(trusted, { baselineSha: "a".repeat(40) }))
      .toEqual({ ok: false, code: "AQ_CREDENTIAL_GUARD_UNTRUSTED_EXECUTION" });
  });

  it.each(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY",
    "POSTGRES_URL", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "GH_TOKEN", "GITHUB_TOKEN", "VERCEL_TOKEN"] as const)(
    "refuses an additional inherited %s credential", (key) => {
      expect(check({ ...trusted, [key]: "secret-fixture" }))
        .toEqual({ ok: false, code: "AQ_CREDENTIAL_GUARD_ALTERNATE_PROVIDER_BLOCKED" });
    },
  );

  it("blocks database/service tokens even without OpenRouter key", () => {
    expect(check({ POSTGRES_URL: "fixture-secret" }))
      .toEqual({ ok: false, code: "AQ_CREDENTIAL_GUARD_UNTRUSTED_EXECUTION" });
  });

  it("allows a no-credential offline smoke without granting a model-quality pass", () => {
    expect(check({ GITHUB_ACTIONS: "false" })).toEqual({ ok: true, hasLiveProviderKey: false });
  });
});
