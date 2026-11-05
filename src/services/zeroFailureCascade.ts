export type CascadeResult = { ok: true; content: string; source: 'wikipedia' | 'local-safe-mode' } | { ok: false; content: string; source: 'unavailable' };

const FALLBACK_TEXT = (isEnglish: boolean) => isEnglish
  ? 'The free response provider is temporarily unavailable. I could not verify an answer from the available public sources, so I will not invent one. Please retry shortly.'
  : '無料の応答サービスが一時的に利用できません。公開情報から回答を確認できなかったため、推測で回答することは避けました。少し時間をおいて再試行してください。';

export function isAutonomousImagePrompt(prompt: string): boolean {
  const value = prompt.normalize('NFKC').toLowerCase();
  return /(画像|イラスト|写真|絵を|絵画|描いて|生成して|海の画像|image|picture|illustration|draw|generate.*(image|picture)|create.*(image|picture))/.test(value);
}

/**
 * Strip Wikipedia's formatting tags, then encode any remaining angle brackets.
 * The second step prevents malformed or unterminated tags from surviving as HTML.
 */
export function sanitizeWikipediaSnippet(snippet: string): string {
  return snippet.replace(/<[^>]*>/g, '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function executeZeroFailureCascade(prompt: string, signal?: AbortSignal): Promise<CascadeResult> {
  const normalized = prompt.normalize('NFKC').trim().slice(0, 4_000);
  const isEnglish = /[a-zA-Z]/.test(normalized) && !/[ぁ-んァ-ヶ一-龠]/.test(normalized);
  if (!normalized || signal?.aborted) return { ok: false, content: FALLBACK_TEXT(isEnglish), source: 'unavailable' };
  // Image requests must never escape through a legacy third-party URL. The
  // dedicated raster API is independently fail-closed until $0 inference is proven.
  if (isAutonomousImagePrompt(normalized)) {
    return { ok: false, content: FALLBACK_TEXT(isEnglish), source: 'unavailable' };
  }

  // No public text-generation provider is called here. Only a labelled public
  // encyclopedia search may be used as a deterministic excerpt fallback.
  const endpoint = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(normalized) + '&format=json&origin=*&srlimit=3';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const response = await fetch(endpoint, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (response.ok) {
      const data = await response.json() as { query?: { search?: Array<{ title?: string; snippet?: string }> } };
      const entries = (data.query?.search ?? []).filter((item) => item.title && item.snippet).slice(0, 3);
      if (entries.length) {
        const excerpt = entries.map((item) => '- ' + item.title + ': ' + sanitizeWikipediaSnippet(item.snippet ?? '') + ' (https://en.wikipedia.org/wiki/' + encodeURIComponent((item.title ?? '').replace(/ /g, '_')) + ')').join('\n');
        return { ok: true, content: (isEnglish ? 'Public-source fallback (Wikipedia search excerpts; verify before relying on them):\n\n' : '公開情報フォールバック（Wikipedia検索抜粋。重要な判断の前に内容を確認してください）：\n\n') + excerpt, source: 'wikipedia' };
      }
    }
  } catch { /* continue to deterministic safe mode */ }

  return { ok: true, content: FALLBACK_TEXT(isEnglish), source: 'local-safe-mode' };
}

export async function recoverWithAutonomousCascade(prompt: string, signal?: AbortSignal): Promise<CascadeResult> {
  return executeZeroFailureCascade(prompt, signal);
}
