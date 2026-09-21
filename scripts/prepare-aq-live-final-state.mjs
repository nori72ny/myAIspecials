import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const exec = promisify(execFile);
const SHA40 = /^[a-f0-9]{40}$/;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`AQ_FINAL_STATE_ENV_MISSING:${name}`);
  return value;
}

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: headers(token),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`AQ_FINAL_STATE_GITHUB_HTTP_${response.status}`);
  return response.json();
}

async function githubBytes(url, token) {
  const response = await fetch(url, {
    headers: headers(token),
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`AQ_FINAL_STATE_DOWNLOAD_HTTP_${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function validShard(value, baselineSha, candidateSha, shardIndex) {
  return value?.schemaVersion === "origin.aq-local-shard-result.v1"
    && value?.ok === true
    && value?.shard?.schemaVersion === "origin.aq-official-shard-comparison.v1"
    && value.shard.shardIndex === shardIndex
    && value.shard.baselineGitSha === baselineSha
    && value.shard.candidateGitSha === candidateSha
    && /^sha256:[a-f0-9]{64}$/.test(String(value.shard.shardDigest || ""));
}

async function main() {
  const repository = required("GITHUB_REPOSITORY");
  const token = required("GITHUB_TOKEN");
  const output = required("GITHUB_OUTPUT");
  const baselineSha = required("BASELINE_SHA");
  const candidateSha = required("CANDIDATE_SHA");
  const stateDir = path.resolve(required("AQ_STATE_DIR"));
  const expectedShardCount = Number(required("EXPECTED_SHARD_COUNT"));

  if (
    !SHA40.test(baselineSha)
    || !SHA40.test(candidateSha)
    || !Number.isInteger(expectedShardCount)
    || expectedShardCount < 1
    || expectedShardCount > 50
  ) {
    throw new Error("AQ_FINAL_STATE_INPUT_INVALID");
  }

  await rm(stateDir, { recursive: true, force: true });
  await mkdir(stateDir, { recursive: true, mode: 0o700 });

  const artifacts = [];
  for (let page = 1; page <= 10; page += 1) {
    const payload = await githubJson(
      `https://api.github.com/repos/${repository}/actions/artifacts?per_page=100&page=${page}`,
      token,
    );
    const pageArtifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
    artifacts.push(...pageArtifacts);
    if (pageArtifacts.length < 100) break;
  }

  const completed = [];
  for (let shardIndex = 0; shardIndex < expectedShardCount; shardIndex += 1) {
    const artifactName = `aq-live-final-shard-${candidateSha}-s${shardIndex}`;
    const artifact = artifacts
      .filter((item) =>
        item
        && !item.expired
        && item.name === artifactName
        && typeof item.archive_download_url === "string"
      )
      .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""))[0];

    if (!artifact) continue;

    const zipPath = path.join(stateDir, `artifact-${shardIndex}.zip`);
    const extractDir = path.join(stateDir, `artifact-${shardIndex}`);
    await writeFile(zipPath, await githubBytes(artifact.archive_download_url, token), { mode: 0o600 });
    await mkdir(extractDir, { recursive: true, mode: 0o700 });
    await exec("unzip", ["-q", "-o", zipPath, "-d", extractDir], {
      timeout: 15_000,
      maxBuffer: 1_048_576,
    });

    const sourcePath = path.join(extractDir, `aq-official-shard-${shardIndex}.json`);
    const raw = await readFile(sourcePath, "utf8");
    const value = JSON.parse(raw);
    if (!validShard(value, baselineSha, candidateSha, shardIndex)) {
      throw new Error(`AQ_FINAL_STATE_ARTIFACT_INVALID:${shardIndex}`);
    }

    await writeFile(
      path.join(stateDir, `aq-official-shard-${shardIndex}.json`),
      raw,
      { mode: 0o600 },
    );
    completed.push(shardIndex);
    await rm(zipPath, { force: true });
    await rm(extractDir, { recursive: true, force: true });
  }

  const missing = Array.from({ length: expectedShardCount }, (_, index) => index)
    .filter((index) => !completed.includes(index));
  const complete = missing.length === 0;

  await appendFile(
    output,
    `complete=${complete ? "true" : "false"}\ncompleted_count=${completed.length}\nnext_index=${complete ? "" : missing[0]}\n`,
    "utf8",
  );
  process.stdout.write(
    `AQ final state ${completed.length}/${expectedShardCount}${complete ? " complete" : ` next=${missing[0]}`}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "AQ_FINAL_STATE_FAILED"}\n`);
  process.exitCode = 1;
});
