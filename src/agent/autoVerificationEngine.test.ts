import { describe, expect, it, vi } from 'vitest';
import { verifyAndSelfFixArtifact } from './autoVerificationEngine';
import type { ToolName } from './toolRegistry';

describe('Agent artifact quality preflight', () => {
  it.each(['code_interpreter', 'document_generator'] as ToolName[])('never fabricates recovery for unavailable %s', async tool => {
    const rerun = vi.fn();
    expect(await verifyAndSelfFixArtifact('', tool, rerun)).toMatchObject({ ok: false, artifact: '', selfFixed: false, attempts: 0 });
    expect(rerun).not.toHaveBeenCalled();
    expect((await verifyAndSelfFixArtifact('echoed request', tool, undefined, { content: 'echoed request' })).ok).toBe(false);
  });
  it.each(['', '  \n\t'])('preserves an empty or whitespace-only file', async artifact => {
    expect(await verifyAndSelfFixArtifact(artifact, 'file_reader')).toMatchObject({ ok: true, artifact });
  });
  it('rejects missing output rather than treating it as an empty file', async () => {
    expect((await verifyAndSelfFixArtifact(undefined as never, 'file_reader')).ok).toBe(false);
  });
  it('preserves source text containing undefined and incomplete code examples', async () => {
    const artifact = 'undefined\n```js\nfunction incomplete(){\n```\nEND';
    expect(await verifyAndSelfFixArtifact(artifact, 'file_reader')).toMatchObject({ ok: true, artifact, attempts: 0, selfFixed: false });
  });
  it('fails oversized output without losing its ending or retrying', async () => {
    const artifact = 'a'.repeat(120_000) + 'END';
    const rerun = vi.fn();
    expect(await verifyAndSelfFixArtifact(artifact, 'file_reader', rerun)).toMatchObject({ ok: false, artifact, issues: ['too_large'], selfFixed: false });
    expect(rerun).not.toHaveBeenCalled();
  });
  it('preserves an artifact exactly at the size boundary', async () => {
    const artifact = 'a'.repeat(120_000);
    expect(await verifyAndSelfFixArtifact(artifact, 'file_reader')).toMatchObject({ ok: true, artifact });
  });
  it.each(['file_writer', 'verification_runner', 'web_search_grounding', 'image_prompt_compiler'] as ToolName[])('does not retry %s on verification failure', async tool => {
    const rerun = vi.fn();
    expect(await verifyAndSelfFixArtifact('', tool, rerun)).toMatchObject({ ok: false, selfFixed: false, attempts: 0 });
    expect(rerun).not.toHaveBeenCalled();
  });
  it('rejects artifacts returned by failed reruns', async () => {
    const rerun = vi.fn().mockResolvedValue({ ok: false, tool: 'repository_explorer', artifact: 'plausible but failed' });
    expect(await verifyAndSelfFixArtifact('', 'repository_explorer', rerun)).toMatchObject({ ok: false, artifact: '', attempts: 2, selfFixed: false });
    expect(rerun).toHaveBeenCalledTimes(2);
  });
  it('rejects successful reruns of the wrong tool', async () => {
    const rerun = vi.fn().mockResolvedValue({ ok: true, tool: 'document_generator', artifact: 'wrong operation' });
    expect(await verifyAndSelfFixArtifact('', 'repository_explorer', rerun)).toMatchObject({ ok: false, selfFixed: false });
  });
  it('requires an actual successful read-only rerun for recovery', async () => {
    const rerun = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({ ok: true, tool: 'repository_explorer', artifact: 'actual contents' });
    expect(await verifyAndSelfFixArtifact('', 'repository_explorer', rerun, { path: 'example.txt' })).toMatchObject({ ok: true, artifact: 'actual contents', attempts: 2, selfFixed: true });
    expect(rerun).toHaveBeenLastCalledWith('repository_explorer', { path: 'example.txt' });
  });
  it('does not remove malformed data to manufacture success', async () => {
    const artifact = 'bad\u0000result';
    expect(await verifyAndSelfFixArtifact(artifact, 'repository_explorer')).toMatchObject({ ok: false, artifact, selfFixed: false });
  });
});
