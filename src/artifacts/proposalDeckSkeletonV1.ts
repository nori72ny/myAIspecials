/**
 * ProposalDeck Skeleton V1 — モデル回答の「固定骨格 Markdown」と、その決定的パーサー。
 *
 * 設計の正本: ~/workspace/origin-fix/PROPOSAL_PR3_DECISIONS_2026-11-12.md 決定1
 * - 提案・プレゼン作成の意図が立った場合のみ、サーバー側指示に骨格を追加し、
 *   モデルには通常の回答生成1回の中で骨格に沿って書かせる（追加のモデル呼び出しなし）。
 * - 回答確定後、この決定的パーサーが骨格 Markdown → ProposalDeckInput に変換する。
 *   骨格として読めない回答は null を返し、呼び出し側はファイルを作らない。
 * - 純関数。LLM は呼ばない。同じ入力には同じ出力。
 *
 * 自由形式フォールバック（2026-11-13 本番事象への対応）:
 * - 経路1のモデルが骨格指示に従わず、見出し記号なしの導入文＋番号付き／太字の
 *   セクション＋箇条書きで提案アウトラインを返すことがある（本番ログで確認）。
 *   厳格パースで読めない場合に限り、その形状だけを対象に決定的な規則で変換する
 *   寛容フォールバック（parseFreeformProposalDeckFallback）を追加で試す。
 * - フォールバックで得た入力も、従来どおり buildProposalDeck の構造検証と
 *   checkProposalDeck の自己チェックを通らなければファイル化されない
 *   （品質ゲートは一切緩めない）。要が揃わない形状は null のまま返す。
 */

import type {
  ProposalDeckInput,
  ProposalDeckSectionInput,
} from './proposalDeckPlannerV1.js';

/**
 * 骨格指示（サーバー側のシステム指示へ追加する固定文）。
 * 見出しの文言はパーサーの照合キーなので、モデルに一字も変えさせない。
 */
export const PROPOSAL_DECK_SKELETON_INSTRUCTION = [
  '提案資料の作成形式（この依頼専用の追加ルール）:',
  'この回答は、そのまま提案資料（スライド）の原稿として使います。以下の固定骨格の Markdown で書いてください。骨格の前後に説明文を付けず、見出しの文言は一字も変えないでください。',
  '',
  '# 提案のタイトル',
  '副題（あれば1行だけ）',
  '',
  '## 要約',
  '結論を表す見出し文を1文で書きます。',
  '- 要点の1つ目',
  '- 要点の2つ目',
  '- 要点の3つ目',
  '',
  '## 課題',
  '現状の結論を「〜です。」で終わる文で書きます。',
  '- **要点の見出し**：補足説明',
  '',
  '## 解決策',
  '（課題と同じ形式で書きます）',
  '',
  '## 価値',
  '（課題と同じ形式で書きます）',
  '',
  '## 計画',
  '（課題と同じ形式で書きます）',
  '',
  '## 費用・効果',
  '（課題と同じ形式で書きます）',
  '',
  '## 次のステップ',
  '依頼事項：相手に決めてほしいこと、頼みたいこと',
  '- 次に取るステップ',
  '- 次に取るステップ',
  '',
  '## 前提・未確認事項',
  '- 与えられていない事実や前提（なければ、この見出しごと省略します）',
  '',
  '守ること:',
  '- 要約の要点は必ず3点にします。',
  '- 各セクションの箇条書きは4件まで、1件は見出しと補足を合わせて60字以内にします。',
  '- 各セクションの最初の1文は、名詞で終わるラベルではなく、「〜です。」で終わる結論の文にします。',
  '- 分からない数値や固有名詞を、[ ] や 〇〇 などのプレースホルダーで書かないでください。与えられていない事実は「前提・未確認事項」に集めます。',
  '- 課題・解決策・価値・計画・費用・効果の5セクションは省略しないでください。',
].join('\n');

type SectionKind = 'summary' | 'closing' | 'assumptions' | 'role';

interface SectionState {
  kind: SectionKind;
  role?: string;
  headline: string;
  message: string;
  points: string[];
  bullets: Array<{ lead: string; detail: string }>;
  ask: string;
  nextSteps: string[];
  assumptions: string[];
}

const ROLE_BY_HEADING: ReadonlyMap<string, string> = new Map([
  ['課題', 'challenge'],
  ['解決策', 'solution'],
  ['価値', 'value'],
  ['計画', 'plan'],
  ['費用・効果', 'cost'],
  ['費用と効果', 'cost'],
  ['費用', 'cost'],
  ['その他', 'other'],
]);

const CLOSING_HEADINGS: ReadonlySet<string> = new Set(['次のステップ', '次ステップ', '締め']);
const ASSUMPTION_HEADINGS: ReadonlySet<string> = new Set(['前提・未確認事項', '前提条件', '前提']);

/** Markdown の強調記法を取り除く（デッキ側はプレーンテキストとして描くため）。 */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*/g, '').replace(/__/g, '').trim();
}

const BULLET_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/;

function splitBullet(text: string): { lead: string; detail: string } {
  const trimmed = text.trim();
  const bold = trimmed.match(/^\*\*(.+?)\*\*\s*(?:[：:]\s*)?([\s\S]*)$/);
  if (bold) {
    return { lead: stripEmphasis(bold[1]), detail: stripEmphasis(bold[2] ?? '') };
  }
  const separatorIndex = (() => {
    const fullWidth = trimmed.indexOf('：');
    if (fullWidth >= 0) return fullWidth;
    return trimmed.indexOf(':');
  })();
  if (separatorIndex >= 0) {
    return {
      lead: stripEmphasis(trimmed.slice(0, separatorIndex)),
      detail: stripEmphasis(trimmed.slice(separatorIndex + 1)),
    };
  }
  return { lead: stripEmphasis(trimmed), detail: '' };
}

function newSection(kind: SectionKind, role?: string): SectionState {
  return {
    kind,
    role,
    headline: '',
    message: '',
    points: [],
    bullets: [],
    ask: '',
    nextSteps: [],
    assumptions: [],
  };
}

/**
 * 骨格 Markdown を ProposalDeckInput へ決定的に変換する。
 * 骨格の要（タイトル／要約／役割セクション／締め）が欠ける場合は null。
 * 点数が3点ちょうどか等の構造検証は buildProposalDeck の担当（ここでは素材を渡す）。
 */
function parseProposalDeckSkeletonStrict(markdown: string): ProposalDeckInput | null {
  if (typeof markdown !== 'string' || markdown.trim() === '') return null;

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let title = '';
  let subtitle = '';
  let presenter = '';
  let date = '';
  let inFence = false;
  let current: SectionState | null = null;
  const sections: SectionState[] = [];
  let summary: SectionState | null = null;
  let closing: SectionState | null = null;
  const assumptions: string[] = [];

  const startSection = (state: SectionState) => {
    current = state;
    if (state.kind === 'role') sections.push(state);
    if (state.kind === 'summary' && !summary) summary = state;
    if (state.kind === 'closing' && !closing) closing = state;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      if (title === '') title = stripEmphasis(h1[1].replace(/\s+#+\s*$/, ''));
      continue;
    }
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const heading = h2[1].replace(/\s+#+\s*$/, '').trim();
      if (heading === '要約') startSection(newSection('summary'));
      else if (CLOSING_HEADINGS.has(heading)) startSection(newSection('closing'));
      else if (ASSUMPTION_HEADINGS.has(heading)) startSection(newSection('assumptions'));
      else startSection(newSection('role', ROLE_BY_HEADING.get(heading) ?? 'other'));
      continue;
    }
    if (line.startsWith('###')) continue;

    const text = line.trim();
    if (text === '') continue;

    // タイトルブロック（最初の ## より前）: 副題・日付・発表者だけを拾う。
    if (!current) {
      if (title === '') continue;
      const dateMatch = text.match(/^日付[：:]\s*(.+)$/);
      if (dateMatch) {
        date = stripEmphasis(dateMatch[1]);
        continue;
      }
      const presenterMatch = text.match(/^発表者[：:]\s*(.+)$/);
      if (presenterMatch) {
        presenter = stripEmphasis(presenterMatch[1]);
        continue;
      }
      if (subtitle === '' && !BULLET_LINE.test(text)) subtitle = stripEmphasis(text);
      continue;
    }

    const bullet = text.match(BULLET_LINE);
    if (current.kind === 'summary') {
      if (bullet) current.points.push(stripEmphasis(bullet[1]));
      else if (current.headline === '') current.headline = stripEmphasis(text);
      continue;
    }
    if (current.kind === 'closing') {
      const body = bullet ? bullet[1] : text;
      const askMatch = body.match(/^依頼事項[：:]\s*(.+)$/);
      if (askMatch) {
        if (current.ask === '') current.ask = stripEmphasis(askMatch[1]);
        continue;
      }
      if (bullet) current.nextSteps.push(stripEmphasis(bullet[1]));
      else if (current.ask === '') current.ask = stripEmphasis(text);
      continue;
    }
    if (current.kind === 'assumptions') {
      assumptions.push(stripEmphasis(bullet ? bullet[1] : text));
      continue;
    }
    // 役割セクション: 最初の本文行が見出し文、箇条書きが bullets。
    if (bullet) current.bullets.push(splitBullet(bullet[1]));
    else if (current.message === '') current.message = stripEmphasis(text);
  }

  if (title === '' || !summary || !closing || sections.length === 0) return null;

  const input: ProposalDeckInput = {
    title,
    summary: { headline: summary.headline, points: summary.points },
    sections: sections.map(
      (section): ProposalDeckSectionInput => ({
        role: section.role,
        message: section.message,
        bullets: section.bullets,
      }),
    ),
    closing: { ask: closing.ask, nextSteps: closing.nextSteps },
    assumptions,
  };
  if (subtitle !== '') input.subtitle = subtitle;
  if (presenter !== '') input.presenter = presenter;
  if (date !== '') input.date = date;
  return input;
}

/**
 * 骨格 Markdown を ProposalDeckInput へ決定的に変換する（公開入口）。
 * まず固定骨格の厳格パースを試し、読めない場合に限り自由形式フォールバックを試す。
 * どちらでも読めなければ null（呼び出し側はファイルを作らない）。
 */
export function parseProposalDeckSkeleton(markdown: string): ProposalDeckInput | null {
  const strict = parseProposalDeckSkeletonStrict(markdown);
  if (strict) return strict;
  return parseFreeformProposalDeckFallback(markdown);
}

// ---------------------------------------------------------------------------
// 自由形式フォールバック
//
// 対象形状（2026-11-13 本番の実回答）:
//   【…】導入文（見出し記号なし）
//   1. 提案の要点 / 2. 主なメリット / … のような番号付き（または太字）セクション
//   各セクションは任意のリード文＋箇条書き、末尾に「確認質問」のような質問節。
//
// 変換規則（すべて決定的・純関数）:
// - セクション見出しは「連番であること＋役割キーワード一致＋40字以内＋
//   コロン（：/:）を含まないこと」を全て満たす行だけを採用する。番号付きの
//   箇条書き等を誤検出しないための歯止めで、条件を満たさない番号行は通常の
//   箇条書きとして扱う。
// - 役割への対応付けは見出し文のキーワードで行う（FREEFORM_KIND_RULES、上から優先）。
// - タイトルは導入文の第1文、要約の見出し文も導入文の第1文（要約セクションに
//   リード文があればそちらを優先）とする。残りの導入文は副題にする。
// - 要約の要点は3点に切り詰める（4点目以降は費用・比較等の他セクションと
//   重なる前提の、形式側の件数合わせ）。3点未満しかなければ null。
// - 役割セクションの箇条書きは設計トークンの上限（4件）に切り詰める。
// - 役割セクションの結論文（message）は、リード文 → 結論文らしい最初の箇条書き
//   （その場合は箇条書きから外す）→ 見出し文からの定型文（「〜は次のとおりです。」）
//   の順で決める。事実の捏造はせず、見出しの言い換えに留める。
// - 締め（closing）の節が無い場合は、計画セクションの箇条書きを次のステップに
//   流用する。どちらも無ければ null。
// - 「確認質問」等の節の項目は assumptions（前提・未確認事項）へ入れる。
// ---------------------------------------------------------------------------

type FreeformSectionKind = 'summary' | 'closing' | 'assumptions' | 'role';

interface FreeformSection {
  kind: FreeformSectionKind;
  role?: string;
  /** 強調記法を除いた見出し文。 */
  heading: string;
  /** 箇条書きでない本文行（出現順）。 */
  leadLines: string[];
  /** 箇条書きの原文（出現順、強調記法を含む）。 */
  bullets: string[];
}

/** 自由形式の見出し文 → 役割。配列の上から順に照合し、最初に一致したものを採る。 */
const FREEFORM_KIND_RULES: ReadonlyArray<{
  pattern: RegExp;
  kind: FreeformSectionKind;
  role?: string;
}> = [
  { pattern: /確認質問|確認事項|質問事項|前提|未確認/, kind: 'assumptions' },
  { pattern: /要約|サマリー|要点|概要/, kind: 'summary' },
  { pattern: /次のステップ|次ステップ|締め/, kind: 'closing' },
  { pattern: /課題|問題|現状|悩み/, kind: 'role', role: 'challenge' },
  { pattern: /費用対効果|費用|価格|料金|コスト|ROI/, kind: 'role', role: 'cost' },
  { pattern: /計画|ステップ|スケジュール|進め方|ロードマップ/, kind: 'role', role: 'plan' },
  { pattern: /価値|メリット|ベネフィット|強み|効果/, kind: 'role', role: 'value' },
  { pattern: /比較|競合/, kind: 'role', role: 'other' },
  {
    pattern: /解決|ソリューション|機能|提案内容|提供内容|サービス内容|アプローチ/,
    kind: 'role',
    role: 'solution',
  },
];

function classifyFreeformHeading(
  heading: string,
): { kind: FreeformSectionKind; role?: string } | null {
  for (const rule of FREEFORM_KIND_RULES) {
    if (rule.pattern.test(heading)) return { kind: rule.kind, role: rule.role };
  }
  return null;
}

/** 見出しだけが単独行になったラベル（確認質問／次のステップ等）の完全一致判定用。 */
const FREEFORM_LABEL_HEADING =
  /^(確認質問|確認事項|質問事項|前提・未確認事項|前提条件|未確認事項|次のステップ|次ステップ)(（[^）]*）)?$/;

/** 結論文かどうかの判定（自己チェック proposalDeckSelfCheckV1 の isAssertion と同じ規則）。 */
const FREEFORM_ASSERTION_ENDING =
  /(です|ます|した|します|できる|できます|なります|あります|います|高い|大きい|小さい|多い|少ない|必要です|可能です|有効です)$/;

function isAssertionSentence(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  if (trimmed.endsWith('。')) return true;
  return FREEFORM_ASSERTION_ENDING.test(trimmed);
}

function toHalfWidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function parseFreeformProposalDeckFallback(markdown: string): ProposalDeckInput | null {
  if (typeof markdown !== 'string' || markdown.trim() === '') return null;

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const introLines: string[] = [];
  const sections: FreeformSection[] = [];
  let current: FreeformSection | null = null;
  let expectedNumber = 1;
  let inFence = false;

  const startSection = (kind: FreeformSectionKind, role: string | undefined, heading: string) => {
    current = { kind, role, heading, leadLines: [], bullets: [] };
    sections.push(current);
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Markdown 見出し行は厳格パーサーの領域。フォールバックでは混ぜない。
    if (/^\s*#/.test(line)) continue;

    const text = line.trim();
    if (text === '') continue;
    const plain = stripEmphasis(text);

    // 見出し判定（番号付き → 太字単独行 → ラベル完全一致、の順）。
    let heading: { kind: FreeformSectionKind; role?: string; text: string } | null = null;
    const numbered = toHalfWidthDigits(plain).match(/^(\d{1,2})\s*[.．)）]\s*(.+)$/);
    if (numbered && Number.parseInt(numbered[1], 10) === expectedNumber) {
      const headingText = numbered[2].trim();
      const classified = classifyFreeformHeading(headingText);
      if (classified && [...headingText].length <= 40 && !/[：:]/.test(headingText)) {
        heading = { ...classified, text: headingText };
        expectedNumber += 1;
      }
    }
    if (!heading && text.startsWith('**') && text.endsWith('**')) {
      const classified = classifyFreeformHeading(plain);
      if (classified && [...plain].length <= 40 && !/[：:]/.test(plain)) {
        heading = { ...classified, text: plain };
      }
    }
    if (!heading) {
      const label = plain.replace(/[：:]$/, '');
      if (FREEFORM_LABEL_HEADING.test(label)) {
        const classified = classifyFreeformHeading(label);
        if (classified) heading = { ...classified, text: label };
      }
    }
    if (heading) {
      startSection(heading.kind, heading.role, heading.text);
      continue;
    }

    const bullet = text.match(BULLET_LINE);
    if (bullet) {
      // 見出しより前の箇条書きは、帰属先がないため拾わない。
      if (current) current.bullets.push(bullet[1]);
      continue;
    }
    if (current) current.leadLines.push(text);
    else introLines.push(text);
  }

  // タイトル: 導入文の第1文（【…】のマーカーは除く）。残りは副題。
  const introBody = introLines
    .map((entry) => stripEmphasis(entry))
    .join('')
    .replace(/^【[^】]*】/, '');
  const firstSentenceMatch = introBody.match(/^[^。]*。/);
  const firstSentence = firstSentenceMatch ? firstSentenceMatch[0] : introBody;
  const title = firstSentence.replace(/。$/, '').trim();
  if (title === '') return null;
  const subtitle = introBody.slice(firstSentence.length).replace(/。$/, '').trim();

  // 要約: 要点系セクションの箇条書きを3点に切り詰める。3点未満は作らない。
  const summarySection = sections.find((section) => section.kind === 'summary');
  if (!summarySection) return null;
  const summaryPoints = summarySection.bullets
    .map((entry) => stripEmphasis(entry))
    .filter((entry) => entry !== '');
  if (summaryPoints.length < 3) return null;
  const summaryHeadline =
    summarySection.leadLines.length > 0
      ? stripEmphasis(summarySection.leadLines[0])
      : firstSentence.trim();

  // 役割セクション: 結論文を決め、箇条書きを上限4件に切り詰める。
  const roleSections = sections.filter((section) => section.kind === 'role');
  if (roleSections.length === 0) return null;
  const builtSections: ProposalDeckSectionInput[] = roleSections.map((section) => {
    let message = section.leadLines.length > 0 ? stripEmphasis(section.leadLines[0]) : '';
    let bulletTexts = section.bullets.slice();
    if (message === '' && bulletTexts.length > 0) {
      const first = stripEmphasis(bulletTexts[0]);
      if (isAssertionSentence(first)) {
        message = first;
        bulletTexts = bulletTexts.slice(1);
      }
    }
    if (message === '') {
      const core = section.heading.replace(/（[^）]*）\s*$/, '').trim();
      message = `${core}は次のとおりです。`;
    }
    return {
      role: section.role,
      message,
      bullets: bulletTexts.slice(0, 4).map((entry) => splitBullet(entry)),
    };
  });

  // 締め: 締め節があればそこから、無ければ計画セクションの箇条書きを流用する。
  let ask = '';
  let nextSteps: string[] = [];
  const closingSection = sections.find((section) => section.kind === 'closing');
  if (closingSection) {
    const absorb = (raw: string, isBullet: boolean) => {
      const body = stripEmphasis(raw);
      if (body === '') return;
      const askMatch = body.match(/^依頼事項[：:]\s*(.+)$/);
      if (askMatch) {
        if (ask === '') ask = askMatch[1].trim();
        return;
      }
      if (isBullet) nextSteps.push(body);
      else if (ask === '') ask = body;
    };
    for (const entry of closingSection.leadLines) absorb(entry, false);
    for (const entry of closingSection.bullets) absorb(entry, true);
  }
  if (nextSteps.length === 0) {
    const planSection = roleSections.find((section) => section.role === 'plan');
    if (planSection) {
      nextSteps = planSection.bullets
        .map((entry) => stripEmphasis(entry))
        .filter((entry) => entry !== '');
    }
  }
  if (nextSteps.length === 0) return null;

  // 前提・未確認事項: 確認質問等の節の項目をすべて集める。
  const assumptions: string[] = [];
  for (const section of sections) {
    if (section.kind !== 'assumptions') continue;
    for (const entry of section.bullets) assumptions.push(stripEmphasis(entry));
    for (const entry of section.leadLines) assumptions.push(stripEmphasis(entry));
  }

  const input: ProposalDeckInput = {
    title,
    summary: { headline: summaryHeadline, points: summaryPoints.slice(0, 3) },
    sections: builtSections,
    closing: { ask, nextSteps },
    assumptions: assumptions.filter((entry) => entry !== ''),
  };
  if (subtitle !== '') input.subtitle = subtitle;
  return input;
}
