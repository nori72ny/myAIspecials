import { describe, expect, it } from 'vitest';
import { TRANSLATIONS, getTranslations, type OriginLanguage } from './i18n';

const languages: OriginLanguage[] = ['ja', 'en'];

describe.each(languages)('ORIGIN Personal translations: %s', (language) => {
  const translations = getTranslations(language);
  const textEntries = Object.entries(translations).filter(([, value]) => typeof value === 'string') as Array<[string, string]>;

  it.each(textEntries)('provides non-empty copy for %s', (_key, value) => {
    expect(value.trim()).not.toBe('');
  });

  it('provides four complete starter-card prompts', () => {
    expect(translations.starterCards).toHaveLength(4);
    for (const card of translations.starterCards) {
      expect(card.title.trim()).not.toBe('');
      expect(card.subtitle.trim()).not.toBe('');
      expect(card.description.trim()).not.toBe('');
      expect(card.prompt.trim()).not.toBe('');
    }
  });

  it('formats the history count in the selected language', () => {
    expect(translations.historyCount(3)).toContain('3');
  });
});

describe('ORIGIN Personal translation contract', () => {
  it('keeps Japanese and English translation keys identical', () => {
    expect(Object.keys(TRANSLATIONS.ja).sort()).toEqual(Object.keys(TRANSLATIONS.en).sort());
  });

  it('exposes translated controls for every audited action', () => {
    for (const language of languages) {
      const t = getTranslations(language);
      expect([t.send, t.stop, t.preview, t.code, t.copy, t.copied, t.download, t.close, t.exportHistory, t.importHistory, t.clearHistory]).not.toContain('');
    }
  });
});
