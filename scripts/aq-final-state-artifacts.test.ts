import { describe, expect, it, vi } from 'vitest';
import { findFinalShardArtifact } from './aq-final-state-artifacts.mjs';
const sha = 'a'.repeat(40);
const name = `aq-live-final-shard-${sha}-s0`;
const artifact = { id: 12, name, expired: false, created_at: '2026-10-03T00:00:00Z', archive_download_url: 'https://untrusted.invalid/file' };
const lookup = (payload: unknown) => {
  const readJson = vi.fn(async () => payload);
  return { readJson, result: findFinalShardArtifact('owner/repo', 'synthetic', sha, 0, { readJson }) };
};
describe('exact AQ shard discovery', () => {
  it('finds the shard by exact name regardless of unrelated repository inventory', async () => {
    const h = lookup({ total_count: 1, artifacts: [artifact] });
    await expect(h.result).resolves.toMatchObject({ id: 12, archive_download_url: 'https://api.github.com/repos/owner/repo/actions/artifacts/12/zip' });
    expect(h.readJson).toHaveBeenCalledExactlyOnceWith(`https://api.github.com/repos/owner/repo/actions/artifacts?per_page=100&name=${name}`, 'synthetic');
  });
  it('returns missing only for a complete empty result', async () => {
    await expect(lookup({ total_count: 0, artifacts: [] }).result).resolves.toBeUndefined();
  });
  it('ignores expired results and selects newest available evidence', async () => {
    await expect(lookup({ total_count: 3, artifacts: [artifact, { ...artifact, id: 13, created_at: '2026-10-03T01:00:00Z' }, { ...artifact, id: 14, expired: true, created_at: '2026-10-03T02:00:00Z' }] }).result).resolves.toMatchObject({ id: 13 });
  });
  it.each([{}, { artifacts: [] }, { total_count: 101, artifacts: [artifact] }, { total_count: -1, artifacts: [] }])('rejects malformed or truncated inventories', async payload => {
    await expect(lookup(payload).result).rejects.toThrow('INVENTORY_INCOMPLETE');
  });
  it.each([{ name: 'other-sha' }, { expired: undefined }, { id: -1 }, { created_at: 'invalid' }])('rejects unexpected artifact metadata', async change => {
    await expect(lookup({ total_count: 1, artifacts: [{ ...artifact, ...change }] }).result).rejects.toThrow('METADATA_INVALID');
  });
  it('propagates read failure instead of treating it as a missing shard', async () => {
    await expect(findFinalShardArtifact('owner/repo', 'synthetic', sha, 0, { readJson: async () => { throw new Error('HTTP_500'); } })).rejects.toThrow('HTTP_500');
  });
  it('rejects invalid inputs before making requests', async () => {
    const readJson = vi.fn();
    await expect(findFinalShardArtifact('../repo', 'synthetic', sha, 0, { readJson })).rejects.toThrow('INPUT_INVALID');
    expect(readJson).not.toHaveBeenCalled();
  });
});
