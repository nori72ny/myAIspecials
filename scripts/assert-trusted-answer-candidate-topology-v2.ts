/**
 * Main-only trusted AQ V2 preflight. No candidate code or private corpus
 * is run or read here. A one-shot sealed evaluation cannot be reserved
 * against a PR that has fallen behind the current protected main.
 */
import {
  assertOriginTrustedAnswerCandidateTopologyV2,
} from "../src/release/OriginTrustedAnswerCandidateTopologyV2.js";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("AQ_V2_CANDIDATE_TOPOLOGY_INPUT_INVALID");
  return value;
}

async function readJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body) throw new Error("AQ_V2_TOPOLOGY_GITHUB_UNAVAILABLE");
  const declared = response.headers.get("content-length");
  if (declared && (!/^[0-9]{1,8}$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new Error("AQ_V2_TOPOLOGY_GITHUB_UNAVAILABLE");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error("AQ_V2_TOPOLOGY_GITHUB_UNAVAILABLE");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("AQ_V2_TOPOLOGY_GITHUB_UNAVAILABLE");
  }
}

async function main(): Promise<void> {
  const repo = required("GITHUB_REPOSITORY");
  const evaluatorSha = required("GITHUB_SHA");
  const candidateSha = required("CANDIDATE_SHA");
  const prNumber = required("PR_NUMBER");
  const token = required("GH_TOKEN");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)
    || !/^[a-f0-9]{40}$/.test(evaluatorSha)
    || !/^[a-f0-9]{40}$/.test(candidateSha)
    || !/^(?:0|[1-9][0-9]{0,6})$/.test(prNumber)
    || token.length < 20) {
    throw new Error("AQ_V2_CANDIDATE_TOPOLOGY_INPUT_INVALID");
  }

  const api = `https://api.github.com/repos/${repo}`;
  const [currentMain, comparison] = await Promise.all([
    readJson(`${api}/branches/main`, token),
    readJson(`${api}/compare/${evaluatorSha}...${candidateSha}?per_page=1`, token),
  ]);
  assertOriginTrustedAnswerCandidateTopologyV2({
    trustedEvaluatorSha: evaluatorSha,
    currentMain,
    candidateSha,
    prNumber,
    comparison,
  });
  process.stdout.write(JSON.stringify({
    event: "aq-v2-trusted-candidate-topology-verified",
    evaluatorSha,
    candidateSha,
    mainHeadMatches: true,
    behindBy: 0,
  }) + "\n");
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^AQ_V2_[A-Z0-9_]+$/.test(error.message)
    ? error.message : "AQ_V2_TOPOLOGY_GITHUB_UNAVAILABLE";
  process.stderr.write(code + "\n");
  process.exitCode = 2;
});
