import { saveDecisionNode, setActiveContextUserId } from './activeContextGraph';

const USER_ID_STORAGE_KEY = 'origin-active-context-user-id:v1';
const INSTALL_FLAG = '__originActiveContextDecisionIngestionInstalled';
const MAX_PROMPT_CHARS = 4_000;
const MAX_ANSWER_CHARS = 6_000;

const DECISION_MARKERS = [
  '決める', '決定', '採用', '選ぶ', '選択', '方針', '優先', '導入', '撤退', '実行', '承認',
  'やる', '進める', '購入', '契約', '投資', '判断', '結論',
  'decide', 'decision', 'choose', 'chosen', 'adopt', 'approve', 'proceed', 'prioritize',
  'recommend', 'recommendation', 'strategy', 'commit', 'invest', 'purchase', 'contract',
];

const VALUE_MARKERS = [
  '重視', '大切', '優先したい', '避けたい', '守る', '価値観', 'コスト', '品質', '安全', '速度', '無料',
  'important', 'value', 'prefer', 'avoid', 'safety', 'quality', 'cost', 'speed', 'free',
];

const SENSITIVE_MARKERS = [
  /api[_ -]?key/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /token/i,
  /authorization:\s*bearer/i,
  /-----begin (?:rsa|ec|private) key-----/i,
  /sk-[a-z0-9_-]{12,}/i,
  /AIza[a-z0-9_-]{20,}/i,
];

function hasMarker(value: string, markers: string[]): boolean {
  const normalized = value.toLocaleLowerCase();
  return markers.some((marker) => normalized.includes(marker.toLocaleLowerCase()));
}

function containsSensitiveInput(value: string): boolean {
  return SENSITIVE_MARKERS.some((pattern) => pattern.test(value));
}

function getOrCreateUserId(): string {
  try {
    const existing = window.localStorage.getItem(USER_ID_STORAGE_KEY)?.trim();
    if (existing) return existing;
    const generated = `origin-user-${window.crypto.randomUUID()}`;
    window.localStorage.setItem(USER_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return 'origin-anonymous-local';
  }
}

function cleanText(value: string, maxChars: number): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxChars);
}

function shouldPersist(prompt: string, answer: string): boolean {
  if (!prompt || !answer || containsSensitiveInput(prompt) || containsSensitiveInput(answer)) return false;
  const decisionSignal = hasMarker(prompt, DECISION_MARKERS) || hasMarker(answer, DECISION_MARKERS);
  const valueSignal = hasMarker(prompt, VALUE_MARKERS);
  return decisionSignal && (valueSignal || prompt.length >= 24 || answer.length >= 180);
}

function extractDecisionData(prompt: string, answer: string): object {
  const conclusion = cleanText(answer.split(/\n+/).find((line) => /^(?:\s*#{1,6}\s*)?(?:【?結論|conclusion|recommendation|recommend)\b/i.test(line)) ?? answer, 900);
  const reason = cleanText(answer, 1_800);
  const values = [
    ...VALUE_MARKERS.filter((marker) => prompt.toLocaleLowerCase().includes(marker.toLocaleLowerCase())),
  ].slice(0, 8);

  return {
    type: 'decision',
    conclusion,
    reason,
    values,
    source: 'automatic-local-extraction',
    promptExcerpt: cleanText(prompt, 1_800),
    answerExcerpt: cleanText(answer, 2_400),
  };
}

async function ingestChatResponse(request: Request, response: Response): Promise<void> {
  try {
    const requestClone = request.clone();
    const responseClone = response.clone();
    const requestBody: unknown = await requestClone.json();
    if (!requestBody || typeof requestBody !== 'object') return;
    const messages = (requestBody as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) return;

    const lastUser = [...messages].reverse().find((message) => (
      Boolean(message)
      && typeof message === 'object'
      && (message as { role?: unknown }).role === 'user'
      && typeof (message as { content?: unknown }).content === 'string'
    )) as { content: string } | undefined;
    if (!lastUser) return;

    const payload = await responseClone.json() as { content?: unknown };
    if (typeof payload.content !== 'string') return;

    const prompt = cleanText(lastUser.content, MAX_PROMPT_CHARS);
    const answer = cleanText(payload.content, MAX_ANSWER_CHARS);
    if (!shouldPersist(prompt, answer)) return;

    const userId = getOrCreateUserId();
    setActiveContextUserId(userId);
    const decisionData = extractDecisionData(prompt, answer);

    // Intentionally fire-and-forget: memory persistence must never block or alter chat UX.
    void saveDecisionNode(userId, decisionData).catch(() => {
      // Fail-safe by design. Local memory is optional and must never surface an error in chat.
    });
  } catch {
    // Fail-safe: malformed requests/responses, storage failures, or parsing errors are ignored.
  }
}

export function installActiveContextDecisionIngestion(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  const win = window as Window & { [INSTALL_FLAG]?: boolean };
  if (win[INSTALL_FLAG]) return;
  win[INSTALL_FLAG] = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof window.fetch>): Promise<Response> => {
    const response = await originalFetch(...args);
    try {
      const request = args[0] instanceof Request
        ? args[0]
        : new Request(typeof args[0] === 'string' ? args[0] : args[0], args[1]);
      const url = new URL(request.url, window.location.href);
      if (url.pathname === '/api/chat' && request.method.toUpperCase() === 'POST' && response.ok) {
        void ingestChatResponse(request, response);
      }
    } catch {
      // Never interfere with the original fetch response.
    }
    return response;
  };
}

installActiveContextDecisionIngestion();
