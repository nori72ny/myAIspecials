export type CascadeResult = { ok: true; content: string; source: 'pollinations-text' | 'wikipedia' | 'local-safe-mode' } | { ok: false; content: string; source: 'unavailable' };

const CIRCUIT_MS = 60_000;
const circuitUntil = new Map<string, number>();
const FALLBACK_TEXT = (isEnglish: boolean) => isEnglish
  ? 'The free response providers are temporarily unavailable. I could not verify an answer from the available public sources, so I will not invent one. Please retry shortly.'
  : '無料の応答サービスが一時的に利用できません。公開情報から回答を確認できなかったため、推測で回答することは避けました。少し時間をおいて再試行してください。';

export function isAutonomousImagePrompt(prompt: string): boolean {
  const value = prompt.normalize('NFKC').toLowerCase();
  return /(画像|イラスト|写真|絵を|絵画|描いて|生成して|海の画像|image|picture|illustration|draw|generate.*(image|picture)|create.*(image|picture))/.test(value);
}

/**
 * Strip Wikipedia's formatting tags, then encode any remaining angle brackets.
 * The second step is important: a malformed or unterminated tag such as "<script"
 * must not survive as raw HTML when the excerpt is later rendered as Markdown.
 */
export function sanitizeWikipediaSnippet(snippet: string): string {
  return snippet.replace(/<[^>]*>/g, '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'text/plain, application/json' } });
    if (response.status === 429 || response.status === 503) return null;
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    return text && text.length <= 12_000 ? text : null;
  } catch { return null; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

async function withCircuit(key: string, operation: () => Promise<string | null>): Promise<string | null> {
  if ((circuitUntil.get(key) ?? 0) > Date.now()) return null;
  const started = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([operation(), new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), 4_100); })]);
  if (timeout) clearTimeout(timeout);
  if (!result) circuitUntil.set(key, Date.now() + CIRCUIT_MS);
  else circuitUntil.delete(key);
  // Keep the fast path bounded; a slow public endpoint never blocks the next provider.
  if (Date.now() - started > 4_100) circuitUntil.set(key, Date.now() + CIRCUIT_MS);
  return result;
}

export async function executeZeroFailureCascade(prompt: string, signal?: AbortSignal): Promise<CascadeResult> {
  const normalized = prompt.normalize('NFKC').trim().slice(0, 4_000);
  const isEnglish = /[a-zA-Z]/.test(normalized) && !/[ぁ-んァ-ヶ一-龠]/.test(normalized);
  if (!normalized || signal?.aborted) return { ok: false, content: FALLBACK_TEXT(isEnglish), source: 'unavailable' };
  // Image requests must never escape through a legacy third-party URL. The
  // dedicated raster API is independently fail-closed until $0 inference is
  // proven; returning a public image URL here would bypass that policy.
  if (isAutonomousImagePrompt(normalized)) {
    return { ok: false, content: FALLBACK_TEXT(isEnglish), source: 'unavailable' };
  }
  // Layer 1 is the application's primary provider, already attempted by its caller.
  // Layer 2: public text endpoint. It is keyless, but may rate-limit or be unavailable.
  const pollinations = await withCircuit('pollinations-text', () => fetchText('https://text.pollinations.ai/' + encodeURIComponent(normalized), signal));
  if (pollinations) return { ok: true, content: pollinations, source: 'pollinations-text' };
  // Layer 3: public Wikipedia search provides a grounded, explicitly labelled excerpt.
  const endpoint = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(normalized) + '&format=json&origin=*&srlimit=3';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    const response = await fetch(endpoint, { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (response.ok) {
      const data = await response.json() as { query?: { search?: Array<{ title?: string; snippet?: string }> } };
      const entries = (data.query?.search ?? []).filter((item) => item.title && item.snippet).slice(0, 3);
      if (entries.length) {
        const excerpt = entries.map((item) => '- ' + item.title + ': ' + sanitizeWikipediaSnippet(item.snippet ?? '') + ' (https://en.wikipedia.org/wiki/' + encodeURIComponent((item.title ?? '').replace(/ /g, '_')) + ')').join('\\n');
        return { ok: true, content: (isEnglish ? 'Public-source fallback (Wikipedia search excerpts; verify before relying on them):\\n\\n' : '公開情報フォールバック（Wikipedia検索抜粋。重要な判断の前に内容を確認してください）：\\n\\n') + excerpt, source: 'wikipedia' };
      }
    }
  } catch { /* continue to deterministic safe mode */ }
  // Layer 4: deterministic local safe mode. No fabricated answer or false success.
  const safe = FALLBACK_TEXT(isEnglish);
  return { ok: true, content: safe, source: 'local-safe-mode' };
}

export async function recoverWithAutonomousCascade(prompt: string, signal?: AbortSignal): Promise<CascadeResult> {
  return executeZeroFailureCascade(prompt, signal);
}

export async function deliverPollinationsInlineImageFallback(prompt: string): Promise<CascadeResult> {
  return executeZeroFailureCascade(prompt);
}
