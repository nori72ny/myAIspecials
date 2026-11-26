import { describe, expect, it } from 'vitest';
import type { AgentDataChunk } from './agentAttachmentData.js';
import { createAgentLocationPageResolver } from './agentValuePageLocations.js';

const chunk = (index: number, fileName: string, text: string): AgentDataChunk => ({ index, fileName, text });

describe('createAgentLocationPageResolver (M-3)', () => {
  const chunks: AgentDataChunk[] = [
    chunk(0, 'a.txt', ['=== Page 1 ===', 'first page body', '=== Page 2 ===', 'second page body'].join('\n')),
    chunk(1, 'a.txt', ['still page two', '=== Page 3 ===', 'third page body'].join('\n')),
    chunk(2, 'b.txt', ['no markers here', 'plain body'].join('\n')),
  ];
  const resolve = createAgentLocationPageResolver(chunks);

  it('resolves a chunk/line location to the page in force at that line', () => {
    expect(resolve('チャンク 1・行 2')).toBe('Page 1');
    expect(resolve('チャンク 1・行 4')).toBe('Page 2');
  });

  it('carries the page across a chunk boundary within one file', () => {
    // Chunk 2 starts mid-page: its first line is still Page 2.
    expect(resolve('チャンク 2・行 1')).toBe('Page 2');
    expect(resolve('チャンク 2・行 3')).toBe('Page 3');
  });

  it('leaves unresolvable locations unchanged and never invents a page', () => {
    // b.txt carries no page markers at all.
    expect(resolve('チャンク 3・行 1')).toBe('チャンク 3・行 1');
    // Unknown chunk index.
    expect(resolve('チャンク 9・行 1')).toBe('チャンク 9・行 1');
  });

  it('passes other location forms through unchanged', () => {
    expect(resolve('Page 16')).toBe('Page 16');
    expect(resolve('第3頁')).toBe('第3頁');
    expect(resolve('')).toBe('');
  });
});
