import { githubJson } from './aq-final-state-github-json.mjs';

// Query the exact shard, rather than silently truncating the repository-wide
// inventory. A partial or malformed response must never authorize another run.
export async function findFinalShardArtifact(repository, token, candidateSha, shardIndex, { readJson = githubJson } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository)
    || repository.split("/")[1] === "." || repository.split("/")[1] === ".."
    || !/^[a-f0-9]{40}$/.test(candidateSha)
    || !Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= 50) {
    throw new Error('AQ_FINAL_STATE_INPUT_INVALID');
  }
  const name = `aq-live-final-shard-${candidateSha}-s${shardIndex}`;
  const url = `https://api.github.com/repos/${repository}/actions/artifacts?per_page=100&name=${encodeURIComponent(name)}`;
  const payload = await readJson(url, token);
  if (!Array.isArray(payload?.artifacts) || !Number.isSafeInteger(payload.total_count)
    || payload.total_count < 0 || payload.total_count !== payload.artifacts.length) {
    throw new Error('AQ_FINAL_STATE_ARTIFACT_INVENTORY_INCOMPLETE');
  }
  for (const item of payload.artifacts) {
    if (item?.name !== name || typeof item.expired !== 'boolean'
      || !Number.isSafeInteger(item.id) || item.id <= 0
      || !Number.isFinite(Date.parse(item.created_at))) {
      throw new Error('AQ_FINAL_STATE_ARTIFACT_METADATA_INVALID');
    }
  }
  const artifact = payload.artifacts.filter(item => !item.expired)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!artifact) return undefined;
  // Build the authenticated download target from the validated repository/id.
  return { ...artifact, archive_download_url: `https://api.github.com/repos/${repository}/actions/artifacts/${artifact.id}/zip` };
}
