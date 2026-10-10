import { describe, expect, it } from "vitest";
import {
  checkOriginAqCredentialBoundary,
  createOriginAqChildEnvironment,
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

describe("AQ benchmark child-process secret minimization", () => {
  const host = {
    PATH: "/usr/local/bin:/usr/bin", HOME: "/home/runner", CI: "true",
    LANG: "ja_JP.UTF-8",
    OPENROUTER_API_KEY: "test-fixture-only",
    GITHUB_TOKEN: "never-child-github-token",
    GH_TOKEN: "never-child-gh-token",
    POSTGRES_URL: "never-child-database",
    SUPABASE_SERVICE_ROLE_KEY: "never-child-service-role",
    OPENAI_API_KEY: "never-child-paid-provider",
    ANTHROPIC_API_KEY: "never-child-other-provider",
    GEMINI_API_KEY: "never-child-other-provider",
    VERCEL_TOKEN: "never-child-vercel",
    AWS_SECRET_ACCESS_KEY: "never-child-unknown-credential",
    DATABASE_URL: "never-child-database",
  };
  it("passes no inherited credential to a candidate or baseline build", () => {
    const child = createOriginAqChildEnvironment(host, { sha: candidateSha, phase: "build" });
    expect(child).toEqual({
      PATH: host.PATH, HOME: host.HOME, CI: "true", LANG: host.LANG,
      NODE_ENV: "production", ORIGIN_RELEASE_SHA: candidateSha,
    });
    expect(Object.keys(child)).not.toContain("OPENROUTER_API_KEY");
  });

  it("passes only the free provider credential and whitelisted metadata to trusted server runtime", () => {
    const child = createOriginAqChildEnvironment(host, {
      sha: candidateSha, phase: "runtime", port: 4312,
    });
    expect(child).toEqual({
      PATH: host.PATH, HOME: host.HOME, CI: "true", LANG: host.LANG,
      NODE_ENV: "production", ORIGIN_RELEASE_SHA: candidateSha,
      PORT: "4312", OPENROUTER_API_KEY: host.OPENROUTER_API_KEY,
    });
    expect(child).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(child).not.toHaveProperty("GITHUB_TOKEN");
  });

  it("does not add a nonexistent provider credential and rejects malformed process identity", () => {
    expect(createOriginAqChildEnvironment({}, {
      sha: candidateSha, phase: "runtime", port: 4311,
    })).toEqual({
      NODE_ENV: "production", ORIGIN_RELEASE_SHA: candidateSha, PORT: "4311",
    });
    expect(() => createOriginAqChildEnvironment(host, {
      sha: "bad", phase: "runtime", port: 4311,
    })).toThrow("AQ_CHILD_ENV_TARGET_INVALID");
    expect(() => createOriginAqChildEnvironment(host, {
      sha: candidateSha, phase: "runtime", port: 22,
    })).toThrow("AQ_CHILD_ENV_TARGET_INVALID");
    expect(() => createOriginAqChildEnvironment(host, {
      sha: candidateSha, phase: "build", port: 4312,
    })).toThrow("AQ_CHILD_ENV_TARGET_INVALID");
  });
});
