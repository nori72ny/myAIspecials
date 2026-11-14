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
  '- 要約の要点は必ず3点にします。要約は見出しだけで済ませず、要点を箇条書きで書いてください。',
  '- 次のステップには、具体的なステップを箇条書きで書いてください。',
  '- 見出しに【Assumption】などのタグや、（前提）（サンプル）といった注記を付けないでください。数値が仮定の場合は、その旨を本文中に明記してください。',
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
// - セクション見出しは「連番であること＋40字以内＋コロン（：/:）を含まない
//   こと」を満たす番号行を採用する。40字・コロンの判定は、注記を除いた
//   見出し本体に対して行う（第5回対応 FIX5-1）。役割キーワードへの一致は受理条件にせず、
//   一致しない見出しは other として保持する（1語の語彙ミスで後続セクション
//   まで連鎖的に失うのを防ぐため）。誤爆は複合条件で抑える: 導入文がある
//   こと、中身のある節が3件以上あること、要約と締めの核が揃うこと。
// - markdown 見出しも取り込む（H1 はタイトル候補、H2 は先行番号を剥がして
//   見出し候補）。markdown 表は箇条書きへ決定的に変換し、結論文の候補には
//   しない。回答全体が単一のコードフェンスで囲われている場合は外枠を剥がす。
// - 役割への対応付けは見出し文のキーワードで行う（FREEFORM_KIND_RULES、
//   上から優先）。分類は括弧内の補足語を除いた見出し本体を優先する。
// - タイトルは、導入の先頭行が短く「。」を含まない場合はその行自体を
//   独立させ、それ以外は導入文の第1文とする。残りの導入文は副題にする
//   （「Bottom line：」等のラベルは混ぜない）。
// - 要約の要点は要約節の箇条書きを3点に切り詰める。3点未満しかない場合は
//   その節の散文を文単位で逐語切り出しして補い（1文80字超は採用しない）、
//   それでも3点未満なら null。
// - 役割セクションの箇条書きは設計トークンの上限（4件）に切り詰める。
// - 役割セクションの結論文（message）は、リード文 → 結論文らしい最初の箇条書き
//   （その場合は箇条書きから外す）→ 見出し文からの定型文（「〜は次のとおりです。」）
//   の順で決める。事実の捏造はせず、見出しの言い換えに留める。
// - 締め（closing）の節が無い場合は、計画セクションの箇条書きを次のステップに
//   流用する。どちらも無ければ null。
// - 「確認質問」等の節の項目は assumptions（前提・未確認事項）へ入れる。
//   締め節に紛れた見出しのない末尾質問も assumptions へ振り分ける。
//
// 第3回本番失敗（2026-11-14）への対応（fix-3）:
// - 行全体が1つの【…】だけからなる行は、括弧内が分類できた場合に限り
//   節見出しとして扱う（【提案の要点】→ 要約、【前提・仮定】→ 前提）。
//   分類できない【…】は従来どおり本文行のまま。
// - 要約の要点は、主たる要約節で3点に満たない場合に限り、他の要約節の
//   箇条書き・散文と、節化されなかった導入の【要点】ブロックの残りの文で
//   逐語補給する（生成・言い換えはしない）。
// - 導入からタイトルが得られない場合は、要約節の見出し文＋「のご提案」を
//   タイトルとする。それも無い場合は従来どおり null。
// - 締め節が散文のみで次のステップが空の場合、締めの本文を文単位で
//   切り出し、依頼事項に使われた文と質問文を除いた残りを次のステップ
//   とする（計画セクション流用の後段の受け皿）。
// - 定型文・タイトルの生成では、見出し文中の【…】／（…）注記を除く。
//
// 第4回本番失敗（2026-11-14）への対応（fix-4）:
// - 回答冒頭の「【要点系】＋本文」という同一行リードは、括弧内が要約に
//   分類でき、かつ直後に箇条書きが続く場合に限り要約節の開始として
//   扱い、行の残りをその節の最初の本文行にする（直下の箇条書きが
//   帰属先を失って破棄され、要約が3点に届かなくなる形への対策）。
//   箇条書きが続かない形は fix-3 の導入補給の経路を維持し、節が
//   始まった後の行には適用しない。
// - 締めが実質空で計画セクションも散文のみの場合、計画セクションの
//   本文も文単位で次のステップの受け皿にする（箇条書き流用と同じ性質）。
// - 分類では、前提系の規則だけは注記（（…）／【…】）の中の語を根拠に
//   一致させない（「市場背景（前提）」が節ごと前提・未確認事項に化ける
//   汚染への対策。他の規則の注記依存の照合は維持する）。あわせて cost
//   規則に「投資対効果」を明示追加する（「効果」に先に一致して価値に
//   誤分類されていた）。
//
// 第5回本番失敗（2026-11-14、bebf30f5）への対応（fix-5）:
// - 見出しの受理判定（40字以内・コロンなし）を、注記（（…）／【…】）を
//   含む見出し文全体ではなく、注記を除いた見出し本体に対して行う
//   （FIX5-1、番号付き見出しと markdown 見出しの両経路）。第4回までの
//   注記対策は分類段（FIX4-3）にだけ入っており、受理段では節見出しが
//   注記ごと拒否され、連番の凍結（最初の見出しの拒否で後続節がすべて
//   箇条書きに降格）と markdown 見出しの読み飛ばし（中身が直前の節へ
//   吸収される）を招いていた。核条件（中身のある節3件以上・要約3点・
//   nextSteps 非空・タイトル規則）は一切緩めていない。
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
  /** markdown 表の行（出現順）。後段で決定的に箇条書きへ変換する。 */
  tableLines: string[];
}

/** 自由形式の見出し文 → 役割。配列の上から順に照合し、最初に一致したものを採る。 */
const FREEFORM_KIND_RULES: ReadonlyArray<{
  pattern: RegExp;
  kind: FreeformSectionKind;
  role?: string;
}> = [
  { pattern: /確認質問|確認事項|質問事項|前提|未確認/, kind: 'assumptions' },
  // 事例は「（簡易サマリー）」等の補足語で要約に誤分類されないよう、要約より先に照合する。
  { pattern: /事例|導入実績|ケーススタディ/, kind: 'role', role: 'other' },
  { pattern: /要約|サマリー|要点|概要/, kind: 'summary' },
  { pattern: /次のステップ|次ステップ|締め/, kind: 'closing' },
  { pattern: /課題|問題|現状|悩み/, kind: 'role', role: 'challenge' },
  { pattern: /費用対効果|投資対効果|費用|価格|料金|コスト|ROI/, kind: 'role', role: 'cost' },
  { pattern: /計画|ステップ|スケジュール|進め方|ロードマップ/, kind: 'role', role: 'plan' },
  { pattern: /価値|メリット|ベネフィット|強み|効果|特長|特徴/, kind: 'role', role: 'value' },
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
  // 括弧内の補足語（「（簡易サマリー）」「（参考例）」等）で本体の分類が
  // 上書きされないよう、まず括弧を除いた見出し本体で照合し、一致しない
  // 場合に限り見出し文全体でも照合する。
  const core = heading
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  // 前提系の分類だけは、注記（（…）／【…】）の中の語を根拠に一致させない
  // （fix-4、「市場背景（前提）」が節ごと前提・未確認事項に化ける汚染への
  // 対策）。注記を除いた見出し本文の語による一致は従来どおり有効。他の
  // 規則は「導入プラン（スケジュール）」のように注記の語へ依存する分類が
  // あるため、従来の2段照合を維持する。
  const annotationFree = heading
    .replace(/【[^】]*】/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  for (const rule of FREEFORM_KIND_RULES) {
    const target = rule.kind === 'assumptions' ? annotationFree : core;
    if (target !== '' && rule.pattern.test(target)) return { kind: rule.kind, role: rule.role };
  }
  for (const rule of FREEFORM_KIND_RULES) {
    if (rule.kind === 'assumptions') continue;
    if (rule.pattern.test(heading)) return { kind: rule.kind, role: rule.role };
  }
  return null;
}

/** 見出し文中の【…】／（…）注記を取り除く（定型文・タイトル生成用）。 */
function stripHeadingAnnotations(heading: string): string {
  return heading
    .replace(/【[^】]*】/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
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

/**
 * 回答全体が単一のコードフェンスで囲われている場合だけ、その外枠を剥がす
 * （Gemma 系モデルが回答全体を ```markdown ... ``` で囲って返す癖への対応）。
 * 内部に別のフェンスを含む場合は「単一のフェンス」とみなさず何もしない。
 */
function stripWholeTextCodeFence(markdown: string): string {
  const lines = markdown.trim().split('\n');
  if (lines.length < 3) return markdown;
  if (!/^\s*```/.test(lines[0])) return markdown;
  if (lines[lines.length - 1].trim() !== '```') return markdown;
  const inner = lines.slice(1, -1);
  if (inner.some((line) => /^\s*```/.test(line))) return markdown;
  return inner.join('\n');
}

/** 散文を文（。区切り）単位に分割する。切り出しのみで、生成・言い換えはしない。 */
function splitSentences(text: string): string[] {
  return (text.match(/[^。]+。?/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '' && sentence !== '。');
}

/** 導入文の先頭にある「Bottom line：」等のラベルを取り除く（本文は残す）。 */
function stripLeadingLabel(text: string): string {
  return text.replace(/^\s*Bottom line\s*[：:]\s*/i, '');
}

/** 質問文の判定（締め節へ紛れた末尾質問を前提・未確認事項へ振り分けるため）。 */
const FREEFORM_QUESTION_PATTERN =
  /[？?]\s*$|教えてください|お聞かせください|ご教示ください|でしょうか/;

/** markdown 表の1行をセル文字列の配列にする。 */
function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => stripEmphasis(cell));
}

function isTableSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * markdown 表を決定的に箇条書きへ変換する（lead = 第1セル、detail = 残りセルを
 * 「：」で連結）。区切り行（---）は除き、区切り行がある表では先頭のヘッダ行
 * （列名）もデータではないため除く。表の行は結論文の候補には決してならない。
 */
function tableLinesToBullets(tableLines: string[]): string[] {
  const rows = tableLines
    .map(parseTableRow)
    .filter((cells) => cells.some((cell) => cell !== ''));
  const hasSeparator = rows.some(isTableSeparatorRow);
  const bullets: string[] = [];
  rows.forEach((cells, index) => {
    if (isTableSeparatorRow(cells)) return;
    if (hasSeparator && index === 0) return;
    const [lead, ...rest] = cells;
    if (!lead) return;
    bullets.push(rest.length > 0 ? `${lead}：${rest.join('：')}` : lead);
  });
  return bullets;
}

function parseFreeformProposalDeckFallback(markdown: string): ProposalDeckInput | null {
  if (typeof markdown !== 'string' || markdown.trim() === '') return null;

  const source = stripWholeTextCodeFence(markdown);
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const introLines: string[] = [];
  const sections: FreeformSection[] = [];
  let current: FreeformSection | null = null;
  let expectedNumber = 1;
  let inFence = false;
  // markdown 見出しで節が作られた文書は骨格形式の試みとみなし、締めの
  // 代替（計画セクションの流用）を適用しない（strict の必須アンカーを
  // フォールバック側で緩めないため）。
  let usedMarkdownHeadings = false;

  const startSection = (kind: FreeformSectionKind, role: string | undefined, heading: string) => {
    current = { kind, role, heading, leadLines: [], bullets: [], tableLines: [] };
    sections.push(current);
  };

  let lineIndex = -1;
  for (const rawLine of lines) {
    lineIndex += 1;
    const line = rawLine.trimEnd();
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // markdown 見出し: H1 はタイトル候補として導入へ、H2 は先行番号を剥がして
    // セクション見出し候補として取り込む（strict で読めた場合はそちらが優先
    // されるため、ここに来るのは strict で読めなかった回答だけ）。
    const mdH1 = line.match(/^#\s+(.+)$/);
    if (mdH1) {
      introLines.push(mdH1[1].replace(/\s+#+\s*$/, '').trim());
      continue;
    }
    const mdH2 = line.match(/^##\s+(.+)$/);
    if (mdH2) {
      const headingText = stripEmphasis(mdH2[1].replace(/\s+#+\s*$/, '').trim())
        .replace(/^\d{1,2}\s*[.．)）]\s*/, '')
        .trim();
      // fix-5（FIX5-1）: 受理判定（40字以内・コロンなし）は、注記を含む
      // 見出し文全体ではなく、注記を除いた見出し本体に対して行う。
      // 見出し文の保持・分類は従来どおり注記を含む原文で行う。
      const headingCore = stripHeadingAnnotations(headingText);
      if (headingCore !== '' && [...headingCore].length <= 40 && !/[：:]/.test(headingCore)) {
        const classified = classifyFreeformHeading(headingText);
        startSection(classified?.kind ?? 'role', classified?.role ?? 'other', headingText);
        usedMarkdownHeadings = true;
      }
      continue;
    }
    if (/^\s*#/.test(line)) continue;

    const text = line.trim();
    if (text === '') continue;
    const plain = stripEmphasis(text);

    // markdown 表の行はセクションに貯め、後段で箇条書きへ変換する。
    // 本文行（leadLines）には入れないため、結論文の候補にはならない。
    if (text.startsWith('|')) {
      if (current) current.tableLines.push(text);
      continue;
    }

    // 見出し判定（番号付き → 太字単独行 → ラベル完全一致、の順）。
    let heading: { kind: FreeformSectionKind; role?: string; text: string } | null = null;
    const numbered = toHalfWidthDigits(plain).match(/^(\d{1,2})\s*[.．)）]\s*(.+)$/);
    if (numbered && Number.parseInt(numbered[1], 10) === expectedNumber) {
      const headingText = numbered[2].trim();
      // fix-5（FIX5-1）: 受理判定は注記を除いた見出し本体に対して行う
      // （markdown 見出し経路と同じ）。本体が空（注記だけの見出し）は受理しない。
      const headingCore = stripHeadingAnnotations(headingText);
      if (headingCore !== '' && [...headingCore].length <= 40 && !/[：:]/.test(headingCore)) {
        // 分類できることは受理条件にしない（1語の語彙ミスで連番が崩壊し、
        // 後続セクションまで連鎖的に失う構造的な弱さへの対策）。分類できない
        // 見出しは other として保持し、構造条件（導入・節数・中身の有無・
        // 要約と締めの核）は後段の判定で担保する。
        const classified = classifyFreeformHeading(headingText);
        heading = classified
          ? { ...classified, text: headingText }
          : { kind: 'role', role: 'other', text: headingText };
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
    if (!heading) {
      // 行全体が1つの【…】だけからなる行は、括弧内が分類できた場合に限り
      // 節見出しとして扱う（【提案の要点】→要約、【前提・仮定】→前提）。
      // 【注意】【参考】等の分類できない【…】は従来どおり本文行に落とす
      // ため、通常文の誤爆にはつながらない。
      const bracket = plain.match(/^【([^】]+)】$/);
      if (bracket) {
        const inner = bracket[1].replace(/[：:]$/, '').trim();
        const classified = classifyFreeformHeading(inner);
        if (classified) heading = { ...classified, text: inner };
      }
    }
    if (!heading && current === null && sections.length === 0) {
      // fix-4: 回答冒頭の「【要点系】＋本文」という同一行リードは、括弧内が
      // 要約に分類でき、かつ直後に箇条書き（- 記号）が続く場合に限り、
      // 要約節の開始として扱い、行の残りをその節の最初の本文行にする。
      // 単独行【…】と対称に扱わないと、直下の要点の箇条書きが「見出し
      // より前の箇条書き」として破棄され、要約が3点に届かなくなる。
      // 箇条書きが続かない形（直後が番号付き見出しになる形）は、導入文
      // として扱い fix-3 の補給経路で処理する従来の挙動を維持する。
      // 適用範囲は節がまだ始まっていない冒頭だけに限り、【お知らせ】等の
      // 要約以外・分類不能の括弧には適用しない。
      const inlineBracket = plain.match(/^【([^】]+)】\s*(.+)$/);
      if (inlineBracket) {
        const inner = inlineBracket[1].replace(/[：:]$/, '').trim();
        if (classifyFreeformHeading(inner)?.kind === 'summary') {
          let nextContentLine = '';
          for (let i = lineIndex + 1; i < lines.length; i += 1) {
            if (lines[i].trim() !== '') {
              nextContentLine = lines[i].trim();
              break;
            }
          }
          if (/^[-*+]\s/.test(nextContentLine)) {
            startSection('summary', undefined, inner);
            const rest = inlineBracket[2].replace(/^[：:]\s*/, '').trim();
            if (rest !== '' && current) current.leadLines.push(rest);
            continue;
          }
        }
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

  // markdown 表は箇条書きへ変換してから、構造条件を判定する。
  for (const section of sections) {
    if (section.tableLines.length > 0) {
      section.bullets.push(...tableLinesToBullets(section.tableLines));
    }
  }
  // 見出しだけで中身のない節は落とす。残った節が3件未満なら、見出し構造が
  // 成立していないものとして作らない（番号付き手順リスト等の誤爆防止の
  // 複合条件: 導入文＋節3件以上＋各節に中身があること）。
  const contentSections = sections.filter(
    (section) => section.leadLines.length > 0 || section.bullets.length > 0,
  );
  if (contentSections.length < 3) return null;

  const summarySection = contentSections.find((section) => section.kind === 'summary');

  // タイトル: 先頭行が短く（40字以内）「。」を含まない場合は、その行自体を
  // タイトルとして独立させる（タイトル行と次の文が連結されて壊れるのを防ぐ）。
  // それ以外は従来どおり導入文の第1文をタイトルとし、残りを副題にする。
  // 「Bottom line：」等のラベルはタイトルにも副題にも混ぜず、本文として扱う。
  const introTexts = introLines.map((entry) => stripEmphasis(entry));
  if (introTexts.length > 0) {
    introTexts[0] = introTexts[0].replace(/^【[^】]*】/, '');
  }
  let title = '';
  let subtitle = '';
  let introFirstSentence = '';
  const firstIntroLine = introTexts[0] ?? '';
  const restIntroText = introTexts.slice(1).join('');
  if (
    firstIntroLine !== '' &&
    [...firstIntroLine].length <= 40 &&
    !firstIntroLine.includes('。') &&
    restIntroText !== ''
  ) {
    title = firstIntroLine.trim();
    const restFirstSentenceMatch = restIntroText.match(/^[^。]*。/);
    introFirstSentence = stripLeadingLabel(
      restFirstSentenceMatch ? restFirstSentenceMatch[0] : restIntroText,
    );
    subtitle = stripLeadingLabel(restIntroText).replace(/。$/, '').trim();
  } else {
    const introBody = introTexts.join('');
    const firstSentenceMatch = introBody.match(/^[^。]*。/);
    const firstSentence = firstSentenceMatch ? firstSentenceMatch[0] : introBody;
    introFirstSentence = firstSentence;
    title = firstSentence.replace(/。$/, '').trim();
    subtitle = introBody.slice(firstSentence.length).replace(/。$/, '').trim();
  }
  if (title === '') {
    // タイトルのフォールバック: 導入が空（冒頭が【提案の要点】等の節から
    // 始まる形）でタイトルが得られない場合に限り、要約節の見出し文
    // （注記を除いた本体）＋「のご提案」をタイトルとする。
    if (summarySection) {
      const core = stripHeadingAnnotations(summarySection.heading);
      if (core !== '') title = `${core}のご提案`;
    }
  }
  if (title === '') return null;

  // 要約: 要点は要約節の箇条書きから作る。3点未満しかない場合は、その節の
  // 散文を文単位で逐語切り出しして補う（1文80字を超える文は要点として
  // 採用しない）。それでも3点に満たなければ作らない。
  if (!summarySection) return null;
  let summaryPoints = summarySection.bullets
    .map((entry) => stripEmphasis(entry))
    .filter((entry) => entry !== '');
  let usedProsePoints = false;
  if (summaryPoints.length < 3) {
    const proseSentences = splitSentences(
      summarySection.leadLines.map((entry) => stripEmphasis(entry)).join(''),
    ).filter((sentence) => [...sentence].length <= 80);
    for (const sentence of proseSentences) {
      if (summaryPoints.length >= 3) break;
      summaryPoints = [...summaryPoints, sentence];
      usedProsePoints = true;
    }
  }
  if (summaryPoints.length < 3) {
    // 補給: 要約の実体が複数の要約節に分かれている形（冒頭の【提案の要点】
    // 節＋「サービス概要」節など）では、他の要約節の箇条書き・散文から
    // 逐語で補う。材料はすべて要約として分類された節の原文に限る。
    for (const other of contentSections) {
      if (summaryPoints.length >= 3) break;
      if (other === summarySection || other.kind !== 'summary') continue;
      for (const entry of other.bullets) {
        if (summaryPoints.length >= 3) break;
        const point = stripEmphasis(entry);
        if (point !== '' && !summaryPoints.includes(point)) summaryPoints.push(point);
      }
      if (summaryPoints.length >= 3) break;
      const otherProse = splitSentences(
        other.leadLines.map((entry) => stripEmphasis(entry)).join(''),
      ).filter((sentence) => [...sentence].length <= 80);
      for (const sentence of otherProse) {
        if (summaryPoints.length >= 3) break;
        if (!summaryPoints.includes(sentence)) {
          summaryPoints.push(sentence);
          usedProsePoints = true;
        }
      }
    }
  }
  if (summaryPoints.length < 3) {
    // 補給（最終段）: 【提案の要点】＋同一行の散文のように、要点ブロックが
    // 節化されず導入に残った形では、導入の残りの文から逐語で補う。
    // タイトル・見出し文に使われた第1文は材料にしない。
    const firstIntroRaw = introLines.length > 0 ? stripEmphasis(introLines[0]) : '';
    const bracketLead = firstIntroRaw.match(/^【([^】]+)】/);
    if (bracketLead && classifyFreeformHeading(bracketLead[1])?.kind === 'summary') {
      const introSource = introLines
        .map((entry) => stripEmphasis(entry))
        .join('')
        .replace(/^【[^】]*】/, '');
      const candidates = splitSentences(introSource).filter(
        (sentence) =>
          [...sentence].length <= 80 &&
          sentence.replace(/。$/, '') !== title &&
          sentence !== introFirstSentence,
      );
      for (const sentence of candidates) {
        if (summaryPoints.length >= 3) break;
        if (!summaryPoints.includes(sentence)) {
          summaryPoints.push(sentence);
          usedProsePoints = true;
        }
      }
    }
  }
  if (summaryPoints.length < 3) return null;
  const summaryHeadline = usedProsePoints
    ? introFirstSentence.trim()
    : summarySection.leadLines.length > 0
      ? stripEmphasis(summarySection.leadLines[0])
      : introFirstSentence.trim();

  // 役割セクション: 結論文を決め、箇条書きを上限4件に切り詰める。
  const roleSections = contentSections.filter((section) => section.kind === 'role');
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
      const core = stripHeadingAnnotations(section.heading);
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
  const closingQuestions: string[] = [];
  const closingSection = contentSections.find((section) => section.kind === 'closing');
  if (closingSection) {
    const absorb = (raw: string, isBullet: boolean) => {
      const body = stripEmphasis(raw);
      if (body === '') return;
      const askMatch = body.match(/^依頼事項[：:]\s*(.+)$/);
      if (askMatch) {
        if (ask === '') ask = askMatch[1].trim();
        return;
      }
      // 見出しのない末尾質問は、締めの依頼事項や次のステップに混ぜず、
      // 前提・未確認事項へ振り分ける。
      if (FREEFORM_QUESTION_PATTERN.test(body)) {
        closingQuestions.push(body);
        return;
      }
      if (isBullet) nextSteps.push(body);
      else if (ask === '') ask = body;
    };
    for (const entry of closingSection.leadLines) absorb(entry, false);
    for (const entry of closingSection.bullets) absorb(entry, true);
  }
  if (nextSteps.length === 0 && !usedMarkdownHeadings) {
    const planSection = roleSections.find((section) => section.role === 'plan');
    if (planSection) {
      nextSteps = planSection.bullets
        .map((entry) => stripEmphasis(entry))
        .filter((entry) => entry !== '');
    }
  }
  if (nextSteps.length === 0 && closingSection) {
    // 締め節が散文のみの形への受け皿: 締めの本文を文単位で切り出し、
    // 依頼事項に使われた文と質問文を除いた残りを次のステップとする
    // （逐語切り出しのみで、生成・言い換えはしない）。
    const askSentences = new Set(splitSentences(ask));
    nextSteps = splitSentences(
      closingSection.leadLines.map((entry) => stripEmphasis(entry)).join(''),
    )
      .filter(
        (sentence) => !askSentences.has(sentence) && !FREEFORM_QUESTION_PATTERN.test(sentence),
      )
      .slice(0, 4);
  }
  if (nextSteps.length === 0 && !usedMarkdownHeadings) {
    // fix-4: 締め節が実質空（見出しのみ、または依頼事項の文だけ）で、
    // 計画セクションも散文のみの形への受け皿。計画セクションの本文を
    // 文単位で切り出し、依頼事項に使われた文と質問文を除いた残りを
    // 次のステップとする。計画セクションの箇条書き流用と同じ性質の
    // 流用であり、材料はすべて原文の文（逐語切り出しのみ）。
    const planSection = roleSections.find((section) => section.role === 'plan');
    if (planSection) {
      const askSentences = new Set(splitSentences(ask));
      nextSteps = splitSentences(
        planSection.leadLines.map((entry) => stripEmphasis(entry)).join(''),
      )
        .filter(
          (sentence) => !askSentences.has(sentence) && !FREEFORM_QUESTION_PATTERN.test(sentence),
        )
        .slice(0, 4);
    }
  }
  if (nextSteps.length === 0) return null;

  // 前提・未確認事項: 確認質問等の節の項目をすべて集める。
  const assumptions: string[] = [];
  for (const section of contentSections) {
    if (section.kind !== 'assumptions') continue;
    for (const entry of section.bullets) assumptions.push(stripEmphasis(entry));
    for (const entry of section.leadLines) assumptions.push(stripEmphasis(entry));
  }
  for (const question of closingQuestions) assumptions.push(question);

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
