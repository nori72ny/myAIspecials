/**
 * ProposalDeck Skeleton V1 — モデル回答の「固定骨格 Markdown」と、その決定的パーサー。
 *
 * 設計の正本: ~/workspace/origin-fix/PROPOSAL_PR3_DECISIONS_2026-11-12.md 決定1
 * - 提案・プレゼン作成の意図が立った場合のみ、サーバー側指示に骨格を追加し、
 *   モデルには通常の回答生成1回の中で骨格に沿って書かせる（追加のモデル呼び出しなし）。
 * - 回答確定後、この決定的パーサーが骨格 Markdown → ProposalDeckInput に変換する。
 *   骨格として読めない回答は null を返し、呼び出し側はファイルを作らない。
 * - 純関数。LLM は呼ばない。同じ入力には同じ出力。
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
export function parseProposalDeckSkeleton(markdown: string): ProposalDeckInput | null {
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
