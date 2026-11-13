// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}));
vi.mock('./pwa/registerServiceWorker', () => ({ registerOriginServiceWorker: vi.fn() }));
vi.mock('./services/activeContextChatBridge', () => ({ installActiveContextChatBridge: vi.fn() }));

import { parseImportedHistory, persistableConversationMessages } from './main';
import type { ConversationMessage } from './App';

type PersistedImage = NonNullable<ConversationMessage['image']>;
const validImage = (providerId: PersistedImage['providerId']): PersistedImage => ({
  assetId: 'a'.repeat(64),
  mimeType: 'image/png',
  downloadName: 'origin-image.png',
  sha256: 'a'.repeat(64),
  providerId,
  model: 'origin-canvas-procedural-v1',
  generationId: `raster-${'b'.repeat(24)}`,
  visualBrainVersion: 'visual-brain-v1',
  planVersion: 'raster-visual-plan-v1',
  planSha256: 'c'.repeat(64),
  purpose: 'photograph',
  typographyOverlay: false,
  sourceCriticVersion: 'raster-structural-critic-v1',
  sourceQualityScore: 100,
  technicalCriticVersion: 'raster-technical-critic-v1',
  technicalQualityScore: 88,
  prompt: '夕焼けの海',
  width: 1024,
  height: 1024,
  relation: 'generated',
});

const validResearch = {
  ok: true,
  version: '1.1',
  status: 'grounded',
  provider: 'DuckDuckGo',
  freeOnly: true,
  costUsd: 0,
  paidFallbackUsed: false,
  sourceCount: 1,
  distinctDomainCount: 1,
  confidence: 'moderate',
  confidenceScope: 'retrieval-evidence-only',
  semanticConflictDetection: 'conservative-structured-only',
  sources: [{ id: 'S1', title: 'Primary source', url: 'https://example.com/a', domain: 'example.com', evidenceLevel: 'page-verified', freshness: 'recent', score: 85, scoreScope: 'retrieval-evidence-only', citation: '[S1](https://example.com/a)' }],
  conflicts: [],
  report: '## 確認できた内容\n- 根拠があります [S1](https://example.com/a)',
};

describe('conversation research history persistence', () => {
  it('keeps a validated research report attached to its message across reload restore', () => {
    const messages = parseImportedHistory({
      messages: [{ id: 'r', role: 'assistant', content: validResearch.report, research: validResearch }],
    });
    expect(messages[0]?.research?.report).toBe(validResearch.report);
    expect(messages[0]?.research?.sources[0]?.title).toBe('Primary source');
  });

  it('drops research data that violates the free-only contract but keeps the report text', () => {
    const messages = parseImportedHistory({
      messages: [{ id: 'r', role: 'assistant', content: 'レポート本文', research: { ...validResearch, freeOnly: false, costUsd: 1, paidFallbackUsed: true } }],
    });
    expect(messages[0]?.content).toBe('レポート本文');
    expect(messages[0]?.research).toBeUndefined();
  });
});

describe('conversation image history persistence', () => {
  it('restores locally generated canvas image metadata after reload', () => {
    const messages = parseImportedHistory({
      messages: [{ id: 'image-1', role: 'assistant', content: '画像を作成しました。', image: validImage('origin-local-canvas') }],
    });
    expect(messages[0]?.image?.providerId).toBe('origin-local-canvas');
    expect(messages[0]?.image?.assetId).toBe('a'.repeat(64));
  });

  it('continues to accept verified free-provider images', () => {
    for (const providerId of ['cloudflare-workers-ai-free', 'pollinations-zero-cost'] as const) {
      const messages = parseImportedHistory({
        messages: [{ id: 'image-1', role: 'assistant', content: 'Generated.', image: validImage(providerId) }],
      });
      expect(messages[0]?.image?.providerId).toBe(providerId);
    }
  });

  it('rejects unknown provider identities rather than restoring unverified images', () => {
    const messages = parseImportedHistory({
      messages: [{ id: 'image-1', role: 'assistant', content: 'Unverified.', image: { ...validImage('cloudflare-workers-ai-free'), providerId: 'unknown-provider' } }],
    });
    expect(messages[0]?.image).toBeUndefined();
  });

  it('persists stable asset metadata while stripping ephemeral object URLs', () => {
    const source = [{
      id: 'image-1',
      role: 'assistant' as const,
      content: '画像を作成しました。',
      image: { ...validImage('origin-local-canvas'), url: 'blob:https://origin.example/ephemeral' },
    }];
    const persisted = persistableConversationMessages(source);
    expect(persisted[0]?.image?.assetId).toBe('a'.repeat(64));
    expect(persisted[0]?.image?.url).toBeUndefined();
  });
});

describe('conversation file artifact history persistence', () => {
  it('strips inline file artifacts (base64 payloads) while keeping the answer text (PR-3a)', () => {
    const source: ConversationMessage[] = [{
      id: 'deck-1',
      role: 'assistant',
      content: '提案資料の構成案です',
      deliveryState: 'verified',
      files: [{
        id: `artifact-pptx-${'a'.repeat(20)}`,
        kind: 'presentation',
        artifactType: 'pptx',
        filename: 'proposal-deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        sha256: 'b'.repeat(64),
        byteLength: 128,
        encoding: 'base64',
        data: 'UEsDBHBwdC9wcmVzZW50YXRpb24ueG1s',
        verified: true,
        verification: ['zip-signature'],
        freeOnly: true,
        costUsd: 0,
        paidFallbackUsed: false,
      }],
    }];
    const persisted = persistableConversationMessages(source);
    expect(persisted[0]?.content).toBe('提案資料の構成案です');
    expect(persisted[0]?.deliveryState).toBe('verified');
    expect(persisted[0]?.files).toBeUndefined();
    expect(JSON.stringify(persisted)).not.toContain('UEsDBHBwdC9wcmVzZW50YXRpb24ueG1s');
  });
});
