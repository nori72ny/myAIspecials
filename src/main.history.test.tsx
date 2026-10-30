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
