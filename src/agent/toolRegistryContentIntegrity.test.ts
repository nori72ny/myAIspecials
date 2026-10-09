import { describe, expect, it, vi } from 'vitest';
vi.mock('./safeRepositoryReader.js', () => ({ listRepository: vi.fn(), readRepositoryFile: vi.fn() }));
import { readRepositoryFile } from './safeRepositoryReader.js';
import { executeToolWithPermission } from './toolRegistry.js';
const approved = { approved: true, costInUSD: 0, safetyPolicyPassed: true };

describe('Agent tool content integrity', () => {
  it('returns the complete file beyond the old 12000 character cutoff', async () => {
    const content = 'あ'.repeat(12_001) + '\nFINAL_SENTINEL';
    vi.mocked(readRepositoryFile).mockResolvedValueOnce(content);
    const result = await executeToolWithPermission('file_reader', { path: 'example.md' }, approved);
    expect(result).toMatchObject({ ok: true, artifact: content });
  });
  it('rejects an oversized file with no partial artifact', async () => {
    vi.mocked(readRepositoryFile).mockResolvedValueOnce('a'.repeat(120_001));
    expect(await executeToolWithPermission('file_reader', { path: 'example.md' }, approved)).toEqual({ ok: false, tool: 'file_reader', message: 'AGENT_FILE_READ_TOO_LARGE' });
  });
  it('rejects oversized input instead of executing a truncated request', async () => {
    await expect(executeToolWithPermission('file_reader', { path: 'a'.repeat(12_001) }, approved)).rejects.toThrow('AGENT_TOOL_INPUT_TOO_LARGE');
  });
});
