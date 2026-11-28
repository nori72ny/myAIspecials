import { describe, expect, it } from 'vitest';
import { buildOrinFeatureCatalog, orinFeatureStatusText } from './orinFeatureCatalog';

const allItems = (health: { voiceOutput: boolean; voiceConversation: boolean; attachments: boolean }) =>
  buildOrinFeatureCatalog(health).flatMap((group) => group.items);
const byId = (health: { voiceOutput: boolean; voiceConversation: boolean; attachments: boolean }, id: string) =>
  allItems(health).find((item) => item.id === id)!;

describe('orinFeatureCatalog (design §6)', () => {
  it('fails closed: read-aloud is "in preparation" unless the health check proves it', () => {
    expect(byId({ voiceOutput: false, voiceConversation: false, attachments: false }, 'read-aloud').status).toBe('preparing');
    expect(byId({ voiceOutput: true, voiceConversation: false, attachments: false }, 'read-aloud').status).toBe('ready');
  });

  it('links the agent description to attachment availability without flipping the item', () => {
    const without = byId({ voiceOutput: false, voiceConversation: false, attachments: false }, 'agent');
    expect(without.status).toBe('ready');
    expect(without.description.ja).toContain('ファイルの添付は準備中です');
    const withAttachments = byId({ voiceOutput: false, voiceConversation: false, attachments: true }, 'agent');
    expect(withAttachments.description.ja).toContain('ファイルの添付もできます');
  });

  it('shows voice conversation as ready only when the entry is actually available (Q8-01)', () => {
    const ready = byId({ voiceOutput: true, voiceConversation: true, attachments: false }, 'voice-talk');
    expect(ready.status).toBe('ready');
    expect(ready.description.ja).toBe('声で話しかけると、その場で会話できます。');
    // The stale promise tied to the listening check must never come back:
    // conversation is live in production and the check was waived.
    expect(ready.description.ja).not.toContain('聞き取り確認');

    const preparing = byId({ voiceOutput: true, voiceConversation: false, attachments: false }, 'voice-talk');
    expect(preparing.status).toBe('preparing');
    expect(preparing.description.ja).toBe('今の端末・ブラウザでは、まだ会話を使えません。');
    expect(preparing.description.ja).not.toContain('聞き取り確認');
    expect(preparing.action).toBeUndefined();
  });

  it('keeps documents at "partly available" with the split explained', () => {
    const documents = byId({ voiceOutput: false, voiceConversation: false, attachments: false }, 'documents');
    expect(documents.status).toBe('partial');
    expect(documents.description.ja).toContain('企画・構成の相談はチャットで使えます');
    expect(documents.description.ja).toContain('文書の自動生成は有効化待ちです');
  });

  it('gives no navigation action to items in preparation', () => {
    for (const item of allItems({ voiceOutput: false, voiceConversation: false, attachments: false })) {
      if (item.status === 'preparing') expect(item.action).toBeUndefined();
    }
  });

  it('gives every item exactly one icon from the single Lucide set (expansion design §6.2)', () => {
    const allowed = new Set(['message-circle', 'search', 'newspaper', 'bot', 'code', 'image', 'file-text', 'volume', 'mic', 'blocks']);
    for (const item of allItems({ voiceOutput: false, voiceConversation: false, attachments: false })) {
      expect(allowed.has(item.icon)).toBe(true);
    }
  });

  it('uses the three honest status labels', () => {
    expect(orinFeatureStatusText('ready', true)).toBe('使えます');
    expect(orinFeatureStatusText('partial', true)).toBe('一部使えます');
    expect(orinFeatureStatusText('preparing', true)).toBe('準備中');
  });
});
