import assert from "node:assert/strict";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function repository(value) {
  assert.match(value ?? "", REPO, "GITHUB_REPOSITORY must be owner/repository.");
  return value;
}

function safeApiBase(value) {
  const url = new URL(value ?? "https://api.github.com");
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "api.github.com", "Release governance verification only permits api.github.com.");
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export async function verifyReleaseGovernance(env = process.env, fetchImpl = fetch) {
  const repo = repository(env.GITHUB_REPOSITORY);
  const apiBase = safeApiBase(env.GITHUB_API_URL);
  const token = env.GITHUB_TOKEN;
  const response = await fetchImpl(`${apiBase}/repos/${repo}/branches/main`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "origin-release-governance/1.0",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, `GitHub main governance lookup failed with HTTP ${response.status}.`);
  const branch = await response.json();
  assert.equal(branch?.name, "main", "GitHub governance response must describe main.");
  assert.equal(
    branch?.protected,
    true,
    "RELEASE_GOVERNANCE_MAIN_UNPROTECTED: main must be protected before Production release approval or publication smoke.",
  );
  return {
    status: "passed",
    branch: "main",
    protected: true,
    sha: String(branch?.commit?.sha ?? ""),
  };
}

if (process.argv[1]?.endsWith("verify-release-governance.mjs")) {
  try {
    console.log(JSON.stringify(await verifyReleaseGovernance()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
