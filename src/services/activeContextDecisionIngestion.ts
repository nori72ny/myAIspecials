import {
  resolveActiveContextUserId,
  upsertMemoryItem,
  type OriginMemoryItem,
  type OriginMemoryKind,
} from './activeContextGraph';
import { checkPersonalMemoryText } from './personalMemoryGuard';

// ---------------------------------------------------------------------------
// Conversation memory ingestion (Personalization Stage 1, PR P1-2).
//
// Rebuilt per PERSONALIZATION_STAGE1_DESIGN_2026-11-16 §5.2. The previous
// design intercepted window.fetch and assumed a JSON chat response, which
// never fires on the streaming main path, so nothing was accumulated
// there. App.tsx now hands every completed chat turn — streaming or JSON —
// to ingestCompletedChatTurn, which extracts memory candidates on-device
// with the deterministic A+B hybrid rules of ORIGIN_MEMORY_DESIGN
// 2026-11-09 §4.2 and stores them through the P1-1 CRUD API:
//
//   A-1 explicit phrasing in the user's message ("覚えておいて", "次回も",
//       "今後は", ...)                                    -> origin 'explicit'
//   A-2 explicit operation (saveExplicitMemory, the entry point for a
//       future "覚える" action on a message)               -> origin 'explicit'
//   B   sentence patterns per kind in the user's message   -> origin 'inferred'
//       (commitment is the one exception sourced from the answer: it is
//       what ORIGIN undertook, per the 2026-11-09 design §3.2)
//
// Extraction runs entirely on-device after the answer is delivered, adds
// zero network requests, and is fully fail-safe: every failure is
// swallowed so chat can never be affected. Candidates pass two protective
// layers before storage — stage-2 topics (name / birth date / address /
// phone number) are excluded at the rule level (§3.3), and the §9.2
// pre-save guard (personalMemoryGuard) runs again inside the storage
// layer itself.
// ---------------------------------------------------------------------------

export interface CompletedChatTurn {
  userText: string;
  answerText: string;
  userMessageId?: string;
  sessionId?: string;
}

export interface ExplicitMemoryRequest {
  text: string;
  kind?: OriginMemoryKind;
  sourceQuote?: string;
  messageId?: string;
  sessionId?: string;
}

interface MemoryCandidate {
  kind: OriginMemoryKind;
  text: string;
  quote: string;
  origin: 'explicit' | 'inferred';
  expiresAt?: number;
}

const MAX_USER_CHARS = 4_000;
const MAX_ANSWER_CHARS = 6_000;
const MAX_MEMORY_TEXT_CHARS = 120; // design §3.2: a distilled short sentence
const MAX_QUOTE_CHARS = 240;
const MAX_USER_ITEMS_PER_TURN = 5;
const MAX_COMMITMENT_ITEMS_PER_TURN = 2;

// --- Shared text helpers -----------------------------------------------------

function cleanText(value: string, maxChars: number): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxChars);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/([。．.!！?？])\s*/g, '$1\n')
    .split(/\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 2);
}

function distill(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_MEMORY_TEXT_CHARS);
}

function isQuestion(sentence: string): boolean {
  return /[？?]\s*$/.test(sentence)
    || /(?:ですか|ますか|でしょうか|かしら|かな)[。．]?\s*$/.test(sentence);
}

// --- Protective exclusions (rule-level layer, design §3.3) -------------------

// Stage-2 topics never become memory items — above all they are never
// extracted as 'fact'. The §9.2 guard is the second layer behind this.
const STAGE2_TOPIC_PATTERNS: readonly RegExp[] = [
  /住所/, /電話番号/, /携帯番号/, /生年月日/, /誕生日/, /氏名/, /本名/,
  /マイナンバー/, /個人番号/, /口座番号/, /カード番号/, /暗証番号/,
  /パスワード/, /郵便番号/, /名前は/,
];

function hasStage2Topic(sentence: string): boolean {
  return STAGE2_TOPIC_PATTERNS.some((pattern) => pattern.test(sentence));
}

// Statements about third parties are not memorized (2026-11-09 §3.2).
const THIRD_PARTY_SUBJECT = /(?:彼|彼女|上司|同僚|部長|課長|先生|母|父|兄|姉|弟|妹|友人|友達|あの人|その人|相手)(?:は|が)/;

function isBlockedSentence(sentence: string): boolean {
  return hasStage2Topic(sentence) || checkPersonalMemoryText(sentence).blocked;
}

// --- A-1: explicit phrasing ----------------------------------------------------

const REMEMBER_PHRASES: readonly string[] = [
  '覚えておいて', '覚えておく', '覚えてください', '覚えていて',
  'メモしておいて', 'メモして', '記録しておいて', '忘れないで', '忘れないように',
];
const CONTINUATION_PHRASES: readonly string[] = [
  '次回も', '次回から', '今後は', '今後も', 'これからも', '毎回', 'いつも',
];
const REMEMBER_PATTERNS_EN: readonly RegExp[] = [/\bremember (?:that|this)\b/i, /\bkeep in mind\b/i];
const CONTINUATION_PATTERNS_EN: readonly RegExp[] = [/\bfrom now on\b/i, /\bnext time\b/i, /\bevery time\b/i];

const GRATITUDE_ONLY = /^(?:いつも|毎回)?\s*(?:ありがとう|お世話になって|助かります|すみません)/;

function stripRememberPhrase(sentence: string, phrase: string | RegExp): string {
  let content = typeof phrase === 'string' ? sentence.split(phrase).join('') : sentence.replace(phrase, '');
  content = content.replace(/^[、,・：:\s]+/u, '');
  content = content.replace(/[、,]\s*ください[。．]?\s*$/u, '。');
  if (content.trim() === 'ください' || content.trim() === 'ください。') content = '';
  return content.trim();
}

function substantiveLength(text: string): number {
  return text.replace(/[。．.!！?？\s]/g, '').length;
}

// --- B: sentence patterns per kind ---------------------------------------------

// Legacy marker lists, kept as one signal for the decision rule.
const DECISION_MARKERS = [
  '決める', '決定', '採用', '選ぶ', '選択', '方針', '優先', '導入', '撤退', '実行', '承認',
  'やる', '進める', '購入', '契約', '投資', '判断', '結論',
  'decide', 'decision', 'choose', 'chosen', 'adopt', 'approve', 'proceed', 'prioritize',
  'recommend', 'recommendation', 'strategy', 'commit', 'invest', 'purchase', 'contract',
];

const DECISION_PATTERNS: readonly RegExp[] = [
  /(?:にする|に決めました|に決めた|に決める|で進めます|で進める|で進めていきます|を採用します|を採用する|を選びます|を選ぶ|をやめます|をやめる|を始めます|を始める)/,
  /(?:予算|上限)は/,
  /\bI (?:decided|have decided|will go with)\b/i,
  /\bwe (?:decided|will go with)\b/i,
];

const PREFERENCE_PATTERNS: readonly RegExp[] = [
  /でお願い(?:します)?/,
  /(?:は|が)(?:苦手|嫌い|好き)/,
  /(?:にしてほしい|してほしいです)/,
  /(?:結論から|結論を先に|先に結論|短くまとめ|簡潔に|箇条書き|表ではなく|表は使わず|文章で|表で)/,
  /\bprefer\b/i,
];

// Durable asks only: one-off imperatives ("要約して") carry no continuity
// signal and are deliberately not memorized as requests (2026-11-09 §3.2).
const REQUEST_PATTERNS: readonly RegExp[] = [
  /(?:しておいて|しておく|しておいてください|しておいてほしい)/,
  /(?:ようにしておいて|ようにしてほしい|ようにお願いします)/,
  /(?:\d{1,2}月\d{1,2}日|明日|明後日|来週|今週|今月|来月|(?:月|火|水|木|金|土|日)曜).{0,24}までに.{0,30}(?:して|お願い|頼む|ほしい|ください)/,
  /\bplease (?:always|keep|make sure)\b/i,
];

const FACT_PATTERNS: readonly RegExp[] = [
  /(?:私は|僕は|わたしは|自分は).{2,}/,
  /(?:仕事は|職業は|担当は|所属は|役割は)/,
  /(?:を担当しています|を担当している|で働いています|で働いている|に勤めています|に勤めている|を使っています|を使っている|を扱っています|を扱っている|を飼っています|を飼っている)/,
  /(?:自宅に|家に).{0,12}(?:はありません|はない|がありません|がない)/,
  /(?:締め切り|期限)は/,
];

const DECLARATIVE_ENDING = /(?:ます|です|だ|である|する|した|たい)[。．]?\s*$/;

function hasMarker(value: string, markers: string[]): boolean {
  const normalized = value.toLocaleLowerCase();
  return markers.some((marker) => normalized.includes(marker.toLocaleLowerCase()));
}

function hasDecisionSignal(sentence: string): boolean {
  if (DECISION_PATTERNS.some((pattern) => pattern.test(sentence))) return true;
  // Legacy marker route, tightened to declarative statements so research
  // imperatives ("採用情報を調べて") do not become decisions.
  return hasMarker(sentence, DECISION_MARKERS) && DECLARATIVE_ENDING.test(sentence);
}

function classifyKind(sentence: string): OriginMemoryKind | null {
  if (hasDecisionSignal(sentence)) return 'decision';
  if (PREFERENCE_PATTERNS.some((pattern) => pattern.test(sentence))) return 'preference';
  if (REQUEST_PATTERNS.some((pattern) => pattern.test(sentence))) return 'request';
  if (FACT_PATTERNS.some((pattern) => pattern.test(sentence))) return 'fact';
  return null;
}

// --- Commitment (answer side) ---------------------------------------------------

const COMMITMENT_PATTERNS: readonly RegExp[] = [
  /(?:次回|今後|毎回|いつも|これから).{0,30}(?:します|いたします|ようにします)/,
  /(?:確認します|お知らせします|連絡します|お送りします|用意します|準備します|対応します|対応いたします|進めていきます)/,
  /\bI(?:'ll| will) (?:check|confirm|let you know|prepare|send|follow up|keep)\b/i,
];

// A commitment needs a future anchor; a bare "確認します" inside the
// current answer ("以下で確認します") is not an undertaking.
const COMMITMENT_ANCHORS: readonly RegExp[] = [
  /(?:次回|今後|毎回|いつも|これから)/,
  /(?:明日|明後日|来週|今週|(?:月|火|水|木|金|土|日)曜|\d{1,2}月\d{1,2}日)/,
  /までに/,
];

const WEEKDAY_INDEX: Record<string, number> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

function endOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy.getTime();
}

function parseCommitmentExpiry(sentence: string, now: number): number | undefined {
  const base = new Date(now);
  if (/明後日/.test(sentence)) {
    base.setDate(base.getDate() + 2);
    return endOfDay(base);
  }
  if (/明日/.test(sentence)) {
    base.setDate(base.getDate() + 1);
    return endOfDay(base);
  }
  const monthDay = sentence.match(/(\d{1,2})月(\d{1,2})日/);
  if (monthDay) {
    const candidate = new Date(base.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]), 23, 59, 59, 999);
    if (candidate.getTime() < now) candidate.setFullYear(candidate.getFullYear() + 1);
    return candidate.getTime();
  }
  const weekday = sentence.match(/([日月火水木金土])曜/);
  if (weekday) {
    const target = WEEKDAY_INDEX[weekday[1]];
    let delta = (target - base.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // "on Friday" said on a Friday means the coming cycle
    base.setDate(base.getDate() + delta);
    return endOfDay(base);
  }
  return undefined;
}

function extractCommitmentCandidates(answerText: string, now: number): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  for (const sentence of splitSentences(answerText)) {
    if (candidates.length >= MAX_COMMITMENT_ITEMS_PER_TURN) break;
    if (isQuestion(sentence) || sentence.includes('ください')) continue;
    if (isBlockedSentence(sentence)) continue;
    if (!COMMITMENT_PATTERNS.some((pattern) => pattern.test(sentence))) continue;
    if (!COMMITMENT_ANCHORS.some((pattern) => pattern.test(sentence))) continue;
    candidates.push({
      kind: 'commitment',
      text: distill(sentence),
      quote: sentence.slice(0, MAX_QUOTE_CHARS),
      origin: 'inferred',
      expiresAt: parseCommitmentExpiry(sentence, now),
    });
  }
  return candidates;
}

// --- User-side extraction (A-1 + B) ----------------------------------------------

function extractUserCandidates(userText: string): MemoryCandidate[] {
  const sentences = splitSentences(userText);
  const used = new Set<number>();
  const candidates: MemoryCandidate[] = [];

  // A-1: explicit phrasing. The marked sentence wins over any B match.
  sentences.forEach((sentence, index) => {
    if (candidates.length >= MAX_USER_ITEMS_PER_TURN) return;
    const rememberPhrase = REMEMBER_PHRASES.find((phrase) => sentence.includes(phrase))
      ?? REMEMBER_PATTERNS_EN.find((pattern) => pattern.test(sentence));
    const continuationPhrase = CONTINUATION_PHRASES.find((phrase) => sentence.includes(phrase))
      ?? CONTINUATION_PATTERNS_EN.find((pattern) => pattern.test(sentence));
    if (!rememberPhrase && !continuationPhrase) return;
    used.add(index);
    if (isBlockedSentence(sentence)) return;

    let content = sentence;
    let sourceIndex = index;
    if (rememberPhrase) {
      content = stripRememberPhrase(sentence, rememberPhrase);
      if (substantiveLength(content) < 4) {
        // The instruction stands alone ("覚えておいてください"); the
        // content is the adjacent sentence (2026-11-09 §4.2: その文、
        // または直前の文脈文).
        const neighborIndex = index > 0 && !used.has(index - 1) ? index - 1
          : index < sentences.length - 1 && !used.has(index + 1) ? index + 1
            : -1;
        if (neighborIndex < 0) return;
        const neighbor = sentences[neighborIndex];
        if (isQuestion(neighbor) || isBlockedSentence(neighbor)) return;
        content = neighbor;
        sourceIndex = neighborIndex;
        used.add(neighborIndex);
      }
    } else {
      if (GRATITUDE_ONLY.test(sentence)) return;
      const remainder = typeof continuationPhrase === 'string'
        ? sentence.split(continuationPhrase).join('')
        : sentence.replace(continuationPhrase as RegExp, '');
      if (substantiveLength(remainder) < 4) return;
    }

    const kind = classifyKind(content) ?? (rememberPhrase ? 'fact' : 'preference');
    candidates.push({
      kind,
      text: distill(content),
      quote: sentences[sourceIndex].slice(0, MAX_QUOTE_CHARS),
      origin: 'explicit',
    });
  });

  // B: sentence patterns over the remaining sentences.
  sentences.forEach((sentence, index) => {
    if (used.has(index) || candidates.length >= MAX_USER_ITEMS_PER_TURN) return;
    if (isQuestion(sentence) || THIRD_PARTY_SUBJECT.test(sentence)) return;
    if (isBlockedSentence(sentence)) return;
    const kind = classifyKind(sentence);
    if (!kind) return;
    candidates.push({
      kind,
      text: distill(sentence),
      quote: sentence.slice(0, MAX_QUOTE_CHARS),
      origin: 'inferred',
    });
  });

  return candidates;
}

// --- Storage ------------------------------------------------------------------------

async function saveCandidates(
  candidates: MemoryCandidate[],
  turn: { userMessageId?: string; sessionId?: string },
): Promise<void> {
  if (!candidates.length) return;
  const userId = resolveActiveContextUserId();
  const now = Date.now();
  for (const candidate of candidates) {
    const item: OriginMemoryItem = {
      id: crypto.randomUUID(),
      kind: candidate.kind,
      text: candidate.text,
      source: {
        ...(turn.sessionId ? { sessionId: turn.sessionId } : {}),
        ...(turn.userMessageId ? { messageId: turn.userMessageId } : {}),
        quote: candidate.quote,
        at: now,
      },
      origin: candidate.origin,
      status: 'active',
      sendToModel: true, // design §3.2: explicit and inferred both default to true
      createdAt: now,
      updatedAt: now,
      pinned: false,
      ...(candidate.expiresAt ? { expiresAt: candidate.expiresAt } : {}),
    };
    // The storage layer re-runs the §9.2 guard and the §4.3 limit rules;
    // a rejection (or any failure) simply skips this item.
    await upsertMemoryItem(userId, item).catch(() => undefined);
  }
}

/**
 * Entry point called by App.tsx after a chat turn completes and the answer
 * has been delivered, for both the streaming and the JSON response paths.
 * Never throws and never performs network requests.
 */
export async function ingestCompletedChatTurn(turn: CompletedChatTurn): Promise<void> {
  try {
    const userText = cleanText(typeof turn?.userText === 'string' ? turn.userText : '', MAX_USER_CHARS);
    const answerText = cleanText(typeof turn?.answerText === 'string' ? turn.answerText : '', MAX_ANSWER_CHARS);
    if (!userText && !answerText) return;
    const now = Date.now();
    const candidates = [
      ...(userText ? extractUserCandidates(userText) : []),
      ...(answerText ? extractCommitmentCandidates(answerText, now) : []),
    ];
    await saveCandidates(candidates, turn ?? {});
  } catch {
    // Fail-safe by design: local memory is optional and must never surface
    // an error in chat.
  }
}

/**
 * A-2 explicit operation (2026-11-09 §4.2): the programmatic entry point
 * for a "覚える" action on a user message or an answer. Saves the given
 * text as an explicit memory item; returns whether it was stored. The
 * stage-2 topic exclusion and the §9.2 guard apply exactly as for
 * automatic extraction.
 */
export async function saveExplicitMemory(request: ExplicitMemoryRequest): Promise<boolean> {
  try {
    const raw = typeof request?.text === 'string' ? request.text : '';
    const text = cleanText(raw, MAX_MEMORY_TEXT_CHARS * 2);
    if (!text) return false;
    if (isBlockedSentence(text)) return false;
    const userId = resolveActiveContextUserId();
    const now = Date.now();
    const item: OriginMemoryItem = {
      id: crypto.randomUUID(),
      kind: request.kind ?? classifyKind(text) ?? 'fact',
      text: distill(text),
      source: {
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        ...(request.messageId ? { messageId: request.messageId } : {}),
        quote: cleanText(request.sourceQuote ?? raw, MAX_QUOTE_CHARS),
        at: now,
      },
      origin: 'explicit',
      status: 'active',
      sendToModel: true,
      createdAt: now,
      updatedAt: now,
      pinned: false,
    };
    const result = await upsertMemoryItem(userId, item);
    return result.saved;
  } catch {
    return false;
  }
}
