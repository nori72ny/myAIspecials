/**
 * 3-A（回答表示の外部比較 2026-11-26 §3）：計算回答に混ざる LaTeX 記法の
 * 表示正規化。レンダラに数式処理が無いため、モデルが出した
 * `$40 \times \frac{3}{4} = 30$` のような記法が生の文字列のまま
 * 利用者の目に触れていた（実測）。KaTeX 等の依存は足さず、表示直前に
 * 代表的な記法だけを通常の文字表記（×、a/b、√ など）へ置き換える。
 *
 * 対象は通常テキストだけ：フェンスコードとコードスパンの中は
 * 文字列として見せるのが正しいので触らない（K-15 の改行正規化と
 * 同じ保護方針）。コピー操作は従来どおり原文を使う（表示だけを整える）。
 *
 * 安全側の線引き：
 * - `$...$` は中身に LaTeX コマンド（バックスラッシュ）か上付き・
 *   下付き記法を含む場合だけ数式として扱う。金額などの
 *   `$40 から $50` はそのまま残す。
 * - 区切りなしでも `\frac{a}{b}` と `\times` 等の代表コマンドは、
 *   通常の文章に現れない記号列なので変換する。
 * - 未知のコマンドは、数式の中ではバックスラッシュを落として読める
 *   形にする（例 `\log` → `log`）。数式の外では触らない。
 */

const COMMAND_GLYPHS: Record<string, string> = {
  times: '×',
  cdot: '·',
  div: '÷',
  pm: '±',
  mp: '∓',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  infty: '∞',
  pi: 'π',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  sigma: 'σ',
  phi: 'φ',
  omega: 'ω',
  Delta: 'Δ',
  Sigma: 'Σ',
  Omega: 'Ω',
  sum: 'Σ',
  prod: 'Π',
  int: '∫',
  partial: '∂',
  cdotp: '·',
  ldots: '…',
  cdots: '…',
  '%': '%',
  ',': ' ',
  ';': ' ',
  ':': ' ',
  '!': '',
  ' ': ' ',
};

const SUPERSCRIPT_CHARS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '(': '⁽', ')': '⁾', n: 'ⁿ', x: 'ˣ',
};

const SUBSCRIPT_CHARS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '(': '₍', ')': '₎',
};

/** 括弧で囲むべき複雑さ（空白や演算子を含む）かどうか。 */
function needsParens(part: string): boolean {
  return /[\s+\-×·÷=<>]/.test(part.trim());
}

function formatFraction(numerator: string, denominator: string): string {
  const top = convertLatexFragment(numerator).trim();
  const bottom = convertLatexFragment(denominator).trim();
  const left = needsParens(top) ? `(${top})` : top;
  const right = needsParens(bottom) ? `(${bottom})` : bottom;
  return `${left}/${right}`;
}

function mapScript(content: string, table: Record<string, string>): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  let mapped = '';
  for (const char of trimmed) {
    const glyph = table[char];
    if (!glyph) return null;
    mapped += glyph;
  }
  return mapped;
}

/**
 * LaTeX 断片（数式の中身、またはコマンドを含む通常テキスト）を
 * 通常の文字表記へ変換する。入れ子の \frac は内側から解けるよう
 * 安定するまで繰り返す（上限つき）。
 */
function convertLatexFragment(input: string): string {
  let text = input;
  for (let round = 0; round < 4; round += 1) {
    const next = text
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a: string, b: string) => formatFraction(a, b))
      .replace(/\\dfrac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a: string, b: string) => formatFraction(a, b))
      .replace(/\\tfrac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a: string, b: string) => formatFraction(a, b))
      .replace(/\\sqrt\{([^{}]*)\}/g, (_m, a: string) => {
        const inner = convertLatexFragment(a).trim();
        return needsParens(inner) ? `√(${inner})` : `√${inner}`;
      })
      .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, '$1')
      .replace(/\\left\s*/g, '')
      .replace(/\\right\s*/g, '')
      .replace(/\\displaystyle\s*/g, '')
      .replace(/\\\{/g, '{')
      .replace(/\\\}/g, '}');
    if (next === text) break;
    text = next;
  }
  // 上付き・下付き：全文字が対応表にあれば上付き文字へ、なければ ^(...) の形。
  text = text.replace(/\^\{([^{}]*)\}/g, (_m, content: string) => mapScript(content, SUPERSCRIPT_CHARS) ?? `^(${content.trim()})`);
  text = text.replace(/_\{([^{}]*)\}/g, (_m, content: string) => mapScript(content, SUBSCRIPT_CHARS) ?? `_(${content.trim()})`);
  text = text.replace(/\^([0-9a-zA-Z])/g, (_m, char: string) => SUPERSCRIPT_CHARS[char] ?? `^${char}`);
  // 既知コマンドをグリフへ（前後の空白は読みやすさのため残す）。
  text = text.replace(/\\([a-zA-Z]+|.)/g, (match, name: string) => {
    const glyph = COMMAND_GLYPHS[name];
    if (glyph !== undefined) return glyph;
    // 未知の英字コマンドはバックスラッシュを落として読める形にする。
    if (/^[a-zA-Z]+$/.test(name)) return name;
    return match;
  });
  // 数式内の改行コマンドと残った波括弧の装飾を取り除く。
  text = text.replace(/\\\\/g, ' ');
  return text;
}

/**
 * 区間の中身が数式らしいか。LaTeX コマンド（バックスラッシュ）か
 * 上付き・下付き記法を含む場合だけ数式として扱い、金額などの
 * `$40 から $50` は通貨の並びとして残す。
 */
function looksLikeMath(inner: string): boolean {
  return inner.includes('\\') || /\^\{|_\{|\^\d/.test(inner);
}

/** `$...$` / `$$...$$` / `\(...\)` / `\[...\]` の数式区間を変換する。 */
function convertMathSpans(segment: string): string {
  let text = segment.replace(/\$\$([^$\n]+)\$\$/g, (match, inner: string) => (
    looksLikeMath(inner) ? convertLatexFragment(inner) : match
  ));
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (match, inner: string) => (
    looksLikeMath(inner) ? convertLatexFragment(inner) : match
  ));
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (match, inner: string) => (
    looksLikeMath(inner) ? convertLatexFragment(inner) : match
  ));
  text = text.replace(/(?<!\$)\$([^$\n]+)\$(?!\$)/g, (match, inner: string) => (
    looksLikeMath(inner) ? convertLatexFragment(inner) : match
  ));
  return text;
}

/**
 * 区切りの外にある代表コマンド（\frac と演算記号系）だけを変換する。
 * 通常の文章に現れない記号列に限るため、散文を壊さない。
 */
function convertBareCommands(segment: string): string {
  let text = segment;
  for (let round = 0; round < 4; round += 1) {
    const next = text.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a: string, b: string) => formatFraction(a, b));
    if (next === text) break;
    text = next;
  }
  return text.replace(/\\(times|cdot|div|pm|le|leq|ge|geq|ne|neq|approx)\b/g, (_m, name: string) => COMMAND_GLYPHS[name] ?? _m);
}

/** 1行の中でコードスパン（バッククォート列）を保護しながら変換する。 */
function convertLine(line: string): string {
  let result = '';
  let rest = line;
  let openTicks = 0;
  const flushPlain = (plain: string) => { result += convertBareCommands(convertMathSpans(plain)); };
  while (rest) {
    const tickMatch = rest.match(/`+/);
    if (!tickMatch || tickMatch.index === undefined) {
      if (openTicks) result += rest; else flushPlain(rest);
      break;
    }
    const before = rest.slice(0, tickMatch.index);
    if (openTicks) result += before; else flushPlain(before);
    const ticks = tickMatch[0];
    result += ticks;
    rest = rest.slice(tickMatch.index + ticks.length);
    if (!openTicks) openTicks = ticks.length;
    else if (ticks.length === openTicks) openTicks = 0;
  }
  return result;
}

/**
 * 回答テキスト全体の数式記法を表示用に正規化する。フェンスコード
 * ブロックの中身は変換しない。
 */
export function normalizeAnswerMath(text: string): string {
  if (!text.includes('\\') && !text.includes('$')) return text;
  const lines = text.split('\n');
  let inFence = false;
  return lines.map((line) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return convertLine(line);
  }).join('\n');
}
