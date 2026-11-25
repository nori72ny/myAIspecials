import { describe, expect, it } from 'vitest';
import { buildOrinFeatureCatalog, orinFeatureStatusText } from './orinFeatureCatalog';

const allItems = (health: { voiceOutput: boolean; attachments: boolean }) =>
  buildOrinFeatureCatalog(health).flatMap((group) => group.items);
const byId = (health: { voiceOutput: boolean; attachments: boolean }, id: string) =>
  allItems(health).find((item) => item.id === id)!;

describe('orinFeatureCatalog (design §6)', () => {
  it('fails closed: read-aloud is "in preparation" unless the health check proves it', () => {
    expect(byId({ voiceOutput: false, attachments: false }, 'read-aloud').status).toBe('preparing');
    expect(byId({ voiceOutput: true, attachments: false }, 'read-aloud').status).toBe('ready');
  });

  it('links the agent description to attachment availability without flipping the item', () => {
    const without = byId({ voiceOutput: false, attachments: false }, 'agent');
    expect(without.status).toBe('ready');
    expect(without.description.ja).toContain('ファイルの添付は準備中です');
    const withAttachments = byId({ voiceOutput: false, attachments: true }, 'agent');
    expect(withAttachments.description.ja).toContain('ファイルの添付もできます');
  });

  it('keeps documents at "partly available" with the split explained', () => {
    const documents = byId({ voiceOutput: false, attachments: false }, 'documents');
    expect(documents.status).toBe('partial');
    expect(documents.description.ja).toContain('企画・構成の相談はチャットで使えます');
    expect(documents.description.ja).toContain('文書の自動生成は有効化待ちです');
  });

  it('gives no navigation action to items in preparation', () => {
    for (const item of allItems({ voiceOutput: false, attachments: false })) {
      if (item.status === 'preparing') expect(item.action).toBeUndefined();
    }
  });

  it('gives every item exactly one icon from the single Lucide set (expansion design §6.2)', () => {
    const allowed = new Set(['message-circle', 'search', 'newspaper', 'bot', 'code', 'image', 'file-text', 'volume', 'mic', 'blocks']);
    for (const item of allItems({ voiceOutput: false, attachments: false })) {
      expect(allowed.has(item.icon)).toBe(true);
    }
  });

  it('uses the three honest status labels', () => {
    expect(orinFeatureStatusText('ready', true)).toBe('使えます');
    expect(orinFeatureStatusText('partial', true)).toBe('一部使えます');
    expect(orinFeatureStatusText('preparing', true)).toBe('準備中');
  });
});
