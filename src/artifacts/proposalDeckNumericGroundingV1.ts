/**
 * ProposalDeck Numeric Grounding V1 — デッキ数値の素材照合（shadow）。
 *
 * 設計の正本:
 * ~/workspace/origin-fix/DOCUMENT_WAVE2_STAGE_MAPPING_AND_DECK_PLAN_2026-11-25.md
 * §3 D-1 / D-2、§4 単位2。
 *
 * 既存の自己チェック（proposalDeckSelfCheckV1）の NUMERIC_TOKEN_NOT_PRESERVED
 * は「原稿 ↔ 組み立て済みデッキ」のトークン多重集合の比較でしかなく、
 * 素材との照合も算術の検証もしない。そのため素材に無い数値の混入
 * （捏造）と計算誤りは、デッキが成立した時点で素通りしていた
 * （2026-11-25 再測定 S-2 / S-4 が created になった主因）。
 * 本モジュールはデッキ側の数値を素材テキストと決定的に照合する:
 *
 * - D-1: デッキの全数値トークンを単位正規化（円 / % / 件数系 / 時間系 /
 *   倍率 / 日付）し、素材に同値が存在するかを確認する。素材に無い値は、
 *   素材値の組からの決定的再構成（同一クラスの加減、件数での乗除、
 *   比率→%・倍、増減率）で説明できる場合に限り根拠ありとする。
 * - D-2: デッキ文中の明示式（A×B＝C、A÷B と %・倍の併記、AはBのP% 型の
 *   主張）を再計算し、表示値と一致するかを確認する。割合主張は両辺が
 *   素材で根拠づく場合にだけ主張として判定し、被演算子自体が素材に
 *   無い場合はその値を未根拠として報告する（% は素材からの派生で
 *   別途判定する。二重報告を避けるための優先順位）。
 *
 * 許容規則は監査ゲート（OriginBusinessPlanningPremiseRecords /
 * OriginBusinessPlanningAudit）と共有する: 丸め一致は
 * |diff| <= max(0.5, scale × 2%)（numbersAgree / formulaResultsAgree と
 * 同じ帯）。直接の転記は単位変換後の厳密一致（float 誤差のみ許容）を
 * 原則とし、% と倍率だけは表示丸めを同じ帯で許す。
 *
 * - 純関数・決定的。モデル呼び出しなし、追加コストなし。
 * - 既定ではどこからも呼ばれない。自己チェックの options 経由でのみ
 *   有効になり、結果は shadow として分離して返る（成立可否は変えない）。
 *   注記・enforce は単位4（オーナー承認待ち）であり本モジュールの範囲外。
 * - 誤検出を出さないことが合格条件: 正当な派生・端数処理・仮置き明示・
 *   序数ラベル（第N・N年目）は違反にしない。
 */

export type ProposalDeckNumericGroundingViolationCode =
  | "NUMERIC_FORMULA_MISMATCH"
  | "NUMERIC_NOT_GROUNDED"
  | "SOURCE_NUMERIC_MISSING";

export interface ProposalDeckNumericGroundingViolation {
  code: ProposalDeckNumericGroundingViolationCode;
  path: string;
  message: string;
}

export interface ProposalDeckTextSegment {
  path: string;
  text: string;
}

export interface ProposalDeckNumericGroundingInput {
  /** 組み立て済みデッキのテキスト（path 付き）。 */
  deckSegments: readonly ProposalDeckTextSegment[];
  /** 素材テキスト（依頼文＋素材。この呼び出し内でのみ使い、保持しない）。 */
  sourceTexts: readonly string[];
  /** 実行当日の日付。当日日付の刻印（例: 「（2026年11月25日時点）」）を根拠なしとしないための基準。 */
  referenceDate?: Date;
}

// ---------------------------------------------------------------------------
// Tokenizer: 単位付き数値トークンへの正規化
// ---------------------------------------------------------------------------

type NumericClass = "money" | "percent" | "count" | "time" | "multiple" | "date";
type TokenClass = NumericClass | "plain";

export interface GroundedNumericToken {
  /** 表示テキスト（表記ゆれ正規化後の断片）。 */
  raw: string;
  /** 正規化値。money は円、percent は %ポイント、time は unit の基準単位、date は 0（dateKey で比較）。 */
  value: number;
  cls: TokenClass;
  /** time の基準単位キー（hour / week / month / day）。それ以外は class 名相当。 */
  unit: string;
  /** date の比較キー（"2026-12-10"、年なしは "MD:12-10"）。 */
  dateKey?: string;
  start: number;
  end: number;
}

/** 年目 / か月目 のラベル（素材側では年・月の時間トークンの根拠として使う）。 */
interface PeriodLabel {
  value: number;
  /** "year" は年目、"month" はか月目。 */
  kind: "year" | "month";
}

interface TokenizeResult {
  tokens: GroundedNumericToken[];
  labels: PeriodLabel[];
}

const COUNT_UNITS: readonly string[] = ["か所", "商品", "件", "回", "社", "店", "人", "点"];
const SCALE: Record<string, number> = { "": 1, "万": 10_000, "億": 100_000_000 };

/** 日付表記を先に抜き出すためのパターン（数値スキャンで断片化しないため）。 */
const DATE_PATTERNS: readonly RegExp[] = [
  /(\d{4})-(\d{1,2})-(\d{1,2})/g,
  /(\d{4})年(\d{1,2})月(\d{1,2})日/g,
  /(\d{1,2})月(\d{1,2})日/g,
];

function normalizeText(text: string): string {
  let normalized = text.normalize("NFKC");
  // ハイフン類（U+2010–U+2015・U+2212）を ASCII に寄せる（期限日付の表記ゆれ）。
  normalized = normalized.replace(/[\u2010-\u2015\u2212]/g, "-");
  // 桁区切りカンマを落とす（数字の間のものだけを繰り返し除去）。
  for (let i = 0; i < 4; i += 1) {
    normalized = normalized.replace(/(\d),(\d)/g, "$1$2");
  }
  return normalized;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * テキストから単位付き数値トークンを抽出する。
 * - 日付は先に抜き出してマスクする（2026年11月25日 が 2026年＋11月＋25日 に割れないため）。
 * - 裸の数（単位なし）は照合対象にしない（年号・連番・見出し番号と区別できないため）。
 *   includePlain の場合だけ、明示式の被演算子として plain トークンを併せて返す。
 * - 年目 / か月目 / 第N… は数量ではなく順序ラベルとして分離する。
 */
function tokenizeNumeric(text: string, includePlain: boolean): TokenizeResult {
  const normalized = normalizeText(text);
  // UTF-16 コード単位の配列にする（matchAll の index と同じ単位でマスクするため）。
  const masked = normalized.split("");
  const tokens: GroundedNumericToken[] = [];
  const labels: PeriodLabel[] = [];

  const maskSpan = (start: number, end: number) => {
    for (let i = start; i < end && i < masked.length; i += 1) masked[i] = " ";
  };

  // 1) 日付
  for (const pattern of DATE_PATTERNS) {
    for (const match of normalized.matchAll(pattern)) {
      const index = match.index ?? 0;
      const raw = match[0];
      // 先行パターンでマスク済みの範囲は二重に拾わない。
      if (masked.slice(index, index + raw.length).join("").trim() === "") continue;
      const dateKey = match[3] !== undefined
        ? `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`
        : `MD:${pad2(Number(match[1]))}-${pad2(Number(match[2]))}`;
      tokens.push({ raw, value: 0, cls: "date", unit: "date", dateKey, start: index, end: index + raw.length });
      maskSpan(index, index + raw.length);
    }
  }

  // 2) 複合表記（A億B万円）: 個別に拾うと値が壊れるため先に処理してマスクする。
  const afterDates = masked.join("");
  const compositePattern = /(\d+(?:\.\d+)?)億(\d+(?:\.\d+)?)万(円|か所|商品|件|回|社|店|人|点)?/g;
  for (const match of afterDates.matchAll(compositePattern)) {
    const index = match.index ?? 0;
    const value = Number(match[1]) * 100_000_000 + Number(match[2]) * 10_000;
    const unit = match[3] ?? "円";
    const isCount = COUNT_UNITS.includes(unit);
    tokens.push({
      raw: match[0],
      value,
      cls: isCount ? "count" : "money",
      unit: isCount ? "count" : "yen",
      start: index,
      end: index + match[0].length,
    });
    maskSpan(index, index + match[0].length);
  }
  const scanText = masked.join("");

  // 3) 通常の数値＋単位
  const numberPattern =
    /(\d+(?:\.\d+)?)(億|万)?(億円|万円|千円|円|%|倍|時間|週間|か月|ヶ月|か所|商品|件|回|社|店|人|点|年目|か月目|年|週|日|分|h|H)?/g;
  for (const match of scanText.matchAll(numberPattern)) {
    const index = match.index ?? 0;
    const raw = match[0];
    const baseValue = Number(match[1]);
    if (!Number.isFinite(baseValue)) continue;
    const scalePart = match[2] ?? "";
    const unitPart = match[3] ?? "";
    // 直前が数字・小数点なら既出トークンの断片なので拾わない。
    if (index > 0 && /[\d.]/.test(scanText[index - 1])) continue;

    // ラベル類（数量ではない）: 年目・か月目、および「第」が直前のもの。
    if (unitPart === "年目" || unitPart === "か月目") {
      labels.push({ value: baseValue, kind: unitPart === "年目" ? "year" : "month" });
      continue;
    }
    if (index > 0 && scanText[index - 1] === "第") continue;

    const push = (value: number, cls: NumericClass, unit: string) => {
      tokens.push({ raw, value, cls, unit, start: index, end: index + raw.length });
    };

    if (unitPart === "円" || unitPart === "万円" || unitPart === "千円" || unitPart === "億円") {
      // 「2.9億円」は scale=億＋円、「1,800万円」は scale=万＋円 として読まれる
      // （正規表現の scale 群が先に一致する）。単位自体の倍率は scale が
      // 空のときにだけ効くため、積はどちらの読みでも同じ値になる。
      const unitScale = unitPart === "万円" ? 10_000 : unitPart === "千円" ? 1_000 : unitPart === "億円" ? 100_000_000 : 1;
      push(baseValue * unitScale * (SCALE[scalePart] ?? 1), "money", "yen");
      continue;
    }
    if (unitPart === "%") {
      push(baseValue, "percent", "percent");
      continue;
    }
    if (unitPart === "倍") {
      push(baseValue, "multiple", "multiple");
      continue;
    }
    if (COUNT_UNITS.includes(unitPart)) {
      push(baseValue * (SCALE[scalePart] ?? 1), "count", "count");
      continue;
    }
    if (unitPart === "時間" || unitPart === "h" || unitPart === "H") {
      push(baseValue, "time", "hour");
      continue;
    }
    if (unitPart === "分") {
      push(baseValue / 60, "time", "hour");
      continue;
    }
    if (unitPart === "週間" || unitPart === "週") {
      push(baseValue, "time", "week");
      continue;
    }
    if (unitPart === "か月" || unitPart === "ヶ月") {
      push(baseValue, "time", "month");
      continue;
    }
    if (unitPart === "年") {
      // 4桁の年は暦年ラベル（2026年 等）であり期間ではない。
      if (baseValue >= 1000) continue;
      push(baseValue * 12, "time", "month");
      continue;
    }
    if (unitPart === "日") {
      push(baseValue, "time", "day");
      continue;
    }
    if (unitPart === "" && scalePart === "" && includePlain) {
      tokens.push({ raw, value: baseValue, cls: "plain", unit: "plain", start: index, end: index + raw.length });
    }
    // 単位なし・scale のみの数（「24万」単独 等）は照合対象にしない。
  }

  tokens.sort((a, b) => a.start - b.start);
  return { tokens, labels };
}

/** 素材・デッキ判定用のトークン抽出（単位付きのみ）。テスト・外部参照用。 */
export function extractGroundedNumericTokens(text: string): GroundedNumericToken[] {
  return tokenizeNumeric(text, false).tokens;
}

// ---------------------------------------------------------------------------
// 一致判定（監査ゲートと共有する許容帯）
// ---------------------------------------------------------------------------

/** 丸め一致: |diff| <= max(0.5, scale × 2%)。監査ゲートの numbersAgree と同じ帯。 */
function numbersAgree(computed: number, stated: number): boolean {
  if (!Number.isFinite(computed) || !Number.isFinite(stated)) return false;
  const diff = Math.abs(computed - stated);
  const scale = Math.max(Math.abs(computed), Math.abs(stated));
  return diff <= Math.max(0.5, scale * 0.02);
}

/** 転記の厳密一致: 単位変換後の同値（float 表現誤差のみ許容）。 */
function valuesVerbatimEqual(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(1e-9, scale * 1e-6);
}

function valueInSet(
  values: ReadonlySet<number>,
  target: number,
  agree: (a: number, b: number) => boolean,
): boolean {
  for (const value of values) {
    if (agree(value, target)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 素材側の値集合と派生集合
// ---------------------------------------------------------------------------

interface SourceIndex {
  /** class+unit → 値集合（直接の根拠）。 */
  direct: Map<string, Set<number>>;
  /** class+unit → 派生値集合（素材値の組からの決定的再構成）。 */
  derived: Map<string, Set<number>>;
  dateKeys: Set<string>;
  labels: PeriodLabel[];
  moneyValues: number[];
  tokens: GroundedNumericToken[];
}

function classKey(cls: TokenClass, unit: string): string {
  return cls === "time" ? `time:${unit}` : cls;
}

function addTo(map: Map<string, Set<number>>, key: string, value: number): void {
  const set = map.get(key) ?? new Set<number>();
  set.add(value);
  map.set(key, set);
}

function buildSourceIndex(sourceTexts: readonly string[]): SourceIndex {
  const direct = new Map<string, Set<number>>();
  const dateKeys = new Set<string>();
  const labels: PeriodLabel[] = [];
  const tokens: GroundedNumericToken[] = [];
  for (const text of sourceTexts) {
    if (typeof text !== "string" || text === "") continue;
    const result = tokenizeNumeric(text, false);
    labels.push(...result.labels);
    for (const token of result.tokens) {
      tokens.push(token);
      if (token.cls === "date") {
        if (token.dateKey) dateKeys.add(token.dateKey);
        continue;
      }
      addTo(direct, classKey(token.cls, token.unit), token.value);
    }
  }

  // 派生: 素材値の組からの決定的再構成（2項まで）。
  const derived = new Map<string, Set<number>>();
  const byKey = new Map<string, GroundedNumericToken[]>();
  for (const token of tokens) {
    if (token.cls === "date") continue;
    const key = classKey(token.cls, token.unit);
    const list = byKey.get(key) ?? [];
    list.push(token);
    byKey.set(key, list);
  }
  const counts = tokens.filter((token) => token.cls === "count");
  const addDerived = (key: string, value: number) => {
    if (Number.isFinite(value) && value > 0) addTo(derived, key, value);
  };

  for (const [key, list] of byKey) {
    const cls = list[0].cls;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (i === j) continue;
        const a = list[i].value;
        const b = list[j].value;
        if (cls === "money" || cls === "count" || cls === "time") {
          addDerived(key, a + b);
          if (a > b) addDerived(key, a - b);
          if (b !== 0) {
            // 比率 → % と 倍（同一クラスの商）。
            addDerived("percent", (a / b) * 100);
            addDerived("multiple", a / b);
            // 増減率（削減率・増加率）: 差を基準側で割る。
            addDerived("percent", (Math.abs(a - b) / b) * 100);
          }
        }
      }
    }
    // 件数での乗除（金額・時間 ×/÷ 件数 → 同クラス）。件数同士の乗除は
    // 比率としてのみ意味を持つため、件数クラス自体には適用しない。
    if (cls === "money" || cls === "time") {
      for (const token of list) {
        for (const count of counts) {
          if (count.value === 0) continue;
          addDerived(key, token.value * count.value);
          addDerived(key, token.value / count.value);
        }
      }
    }
  }

  return {
    direct,
    derived,
    dateKeys,
    labels,
    moneyValues: tokens.filter((token) => token.cls === "money").map((token) => token.value),
    tokens,
  };
}

/** トークン1件が素材で直接・派生いずれかにより根拠づくか。 */
function isGrounded(token: GroundedNumericToken, index: SourceIndex): boolean {
  if (token.cls === "date") {
    return token.dateKey !== undefined && index.dateKeys.has(token.dateKey);
  }
  if (token.cls === "plain") return false;
  const key = classKey(token.cls, token.unit);
  const directSet = index.direct.get(key);
  if (directSet) {
    // % と倍率は表示丸めを許容帯で、それ以外は単位変換後の厳密一致。
    const agree = token.cls === "percent" || token.cls === "multiple" ? numbersAgree : valuesVerbatimEqual;
    if (valueInSet(directSet, token.value, agree)) return true;
  }
  const derivedSet = index.derived.get(key);
  if (derivedSet && valueInSet(derivedSet, token.value, numbersAgree)) return true;
  // 年目 / か月目 ラベルとの対応（素材の「3年目」は、デッキの「3年」と同じ期間を指す）。
  if (token.cls === "time" && token.unit === "month") {
    for (const label of index.labels) {
      const labelMonths = label.kind === "year" ? label.value * 12 : label.value;
      if (valuesVerbatimEqual(labelMonths, token.value)) return true;
    }
  }
  return false;
}

/**
 * 回収期間の裏付け: 素材の金額ペア（小さい方 ÷ 大きい方）が主張された
 * 期間以下に収まる組が存在すれば、その期間トークンは根拠ありとする。
 * どれがコストでどれが年額フローかは決定的には判定できないため、
 * shadow の範囲で「素材の金額同士の比が期間内に収まる組がある」こと
 * だけを見る（緩い規則であることをここに明記する）。
 */
function isPaybackSupported(token: GroundedNumericToken, index: SourceIndex): boolean {
  if (token.cls !== "time" || token.unit !== "month") return false;
  const boundYears = token.value / 12;
  if (!(boundYears > 0)) return false;
  for (const cost of index.moneyValues) {
    for (const annual of index.moneyValues) {
      if (cost > 0 && annual > 0 && cost <= annual && cost / annual <= boundYears * 1.000_001) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// D-2: 明示式の再計算
// ---------------------------------------------------------------------------

type FormulaClass = TokenClass | "ratio";

interface FormulaValue {
  cls: FormulaClass;
  /** time のときの基準単位キー。それ以外は ""。 */
  unit: string;
  value: number;
}

function toFormulaValue(token: GroundedNumericToken): FormulaValue {
  return {
    cls: token.cls,
    unit: token.cls === "time" ? token.unit : "",
    value: token.value,
  };
}

/** 次元代数（監査ゲートの dimension 規則と同じ考え方）。 */
function multiplyClass(a: FormulaValue, b: FormulaValue): FormulaValue | null {
  const combine = (cls: FormulaClass, unit: string, value: number): FormulaValue => ({ cls, unit, value });
  if (a.cls === "ratio") return combine(b.cls, b.unit, a.value * b.value);
  if (b.cls === "ratio") return combine(a.cls, a.unit, a.value * b.value);
  if (a.cls === "plain") return combine(b.cls, b.unit, a.value * b.value);
  if (b.cls === "plain") return combine(a.cls, a.unit, a.value * b.value);
  if (a.cls === "count" && b.cls !== "count") return combine(b.cls, b.unit, a.value * b.value);
  if (b.cls === "count" && a.cls !== "count") return combine(a.cls, a.unit, a.value * b.value);
  if (a.cls === "count" && b.cls === "count") return combine("count", "", a.value * b.value);
  return null;
}

function divideClass(a: FormulaValue, b: FormulaValue): FormulaValue | null {
  const combine = (cls: FormulaClass, unit: string, value: number): FormulaValue => ({ cls, unit, value });
  if (b.cls === "ratio") return combine(a.cls, a.unit, a.value / b.value);
  if (a.cls === b.cls && a.cls !== "plain" && a.unit === b.unit) return combine("ratio", "", a.value / b.value);
  if (a.cls === "plain" && b.cls === "plain") return combine("ratio", "", a.value / b.value);
  if (b.cls === "plain" || b.cls === "count") return combine(a.cls, a.unit, a.value / b.value);
  if (a.cls === "plain") return combine("ratio", "", a.value / b.value);
  return null;
}

/** 計算結果と表示トークンの比較（比率は %・倍 トークンへ読み替える）。 */
function formulaResultAgrees(computed: FormulaValue, stated: GroundedNumericToken): boolean {
  if (computed.cls === "ratio") {
    if (stated.cls === "percent") return numbersAgree(computed.value * 100, stated.value);
    if (stated.cls === "multiple") return numbersAgree(computed.value, stated.value);
    if (stated.cls === "plain") return numbersAgree(computed.value, stated.value);
    return false;
  }
  if (stated.cls === "plain") return numbersAgree(computed.value, stated.value);
  if (computed.cls !== stated.cls) return false;
  if (computed.cls === "time" && computed.unit !== stated.unit) return false;
  return numbersAgree(computed.value, stated.value);
}

function roundForMessage(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

function referenceDateKey(referenceDate?: Date): string | null {
  if (!referenceDate || Number.isNaN(referenceDate.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(referenceDate);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function checkProposalDeckNumericGrounding(
  input: ProposalDeckNumericGroundingInput,
): ProposalDeckNumericGroundingViolation[] {
  const violations: ProposalDeckNumericGroundingViolation[] = [];
  const index = buildSourceIndex(input.sourceTexts ?? []);
  const referenceKey = referenceDateKey(input.referenceDate);

  const add = (code: ProposalDeckNumericGroundingViolationCode, path: string, message: string) => {
    violations.push({ code, path, message });
  };

  const deckTokensAll: GroundedNumericToken[] = [];

  for (const segment of input.deckSegments ?? []) {
    const text = typeof segment?.text === "string" ? segment.text : "";
    if (text === "") continue;
    const path = segment.path;
    const assumptionSegment = /仮置き|仮定/.test(text);
    const { tokens } = tokenizeNumeric(text, true);
    const unitTokens = tokens.filter((token) => token.cls !== "plain");
    deckTokensAll.push(...unitTokens);

    // 式・主張で判定済みの「結果」トークン（被演算子は D-1 で別途判定する）。
    const judged = new Set<GroundedNumericToken>();

    const normalized = normalizeText(text);
    const between = (a: GroundedNumericToken, b: GroundedNumericToken) => normalized.slice(a.end, b.start);
    const opBetween = (a: GroundedNumericToken, b: GroundedNumericToken | undefined): "×" | "÷" | null => {
      if (!b) return null;
      const gap = between(a, b).trim();
      if (gap === "×" || gap === "✕" || gap === "*") return "×";
      if (gap === "÷") return "÷";
      return null;
    };

    // --- D-2a: A op B (= C) 型の明示式 ---
    for (let i = 0; i < tokens.length; i += 1) {
      if (!opBetween(tokens[i], tokens[i + 1])) continue;
      let acc: FormulaValue | null = toFormulaValue(tokens[i]);
      const operands: GroundedNumericToken[] = [tokens[i]];
      let cursor = i;
      let valid = true;
      while (cursor + 1 < tokens.length) {
        const op = opBetween(tokens[cursor], tokens[cursor + 1]);
        if (!op) break;
        const rhs = toFormulaValue(tokens[cursor + 1]);
        if (!acc || (op === "÷" && rhs.value === 0)) {
          valid = false;
          break;
        }
        const next = op === "×" ? multiplyClass(acc, rhs) : divideClass(acc, rhs);
        if (next === null) {
          valid = false;
          break;
        }
        acc = next;
        operands.push(tokens[cursor + 1]);
        cursor += 1;
      }
      if (!valid || !acc || operands.length < 2) continue;

      const resultToken = tokens[cursor + 1];
      const hasEquals = resultToken !== undefined
        && (between(tokens[cursor], resultToken).trim() === "=");
      if (hasEquals && resultToken) {
        judged.add(resultToken);
        if (!formulaResultAgrees(acc, resultToken)) {
          add(
            "NUMERIC_FORMULA_MISMATCH",
            path,
            `明示式の計算結果が表示値と一致しません: ${resultToken.raw}（式の再計算: ${roundForMessage(acc.value)}）: ${path}`,
          );
        } else {
          // 式が一致しても、被演算子が素材に無ければ結果も根拠なしとする。
          const operandsGrounded = operands.every(
            (operand) => operand.cls === "plain" || isGrounded(operand, index),
          );
          if (!operandsGrounded && !assumptionSegment) {
            add(
              "NUMERIC_NOT_GROUNDED",
              path,
              `素材に根拠のない数値です: ${resultToken.raw}: ${path}`,
            );
          }
        }
        i = cursor + 1;
        continue;
      }
      // 結果表示のない単一の割り算（A÷B）: 同一セグメントの %・倍 トークンと照合する。
      if (operands.length === 2 && acc.cls === "ratio") {
        const rateToken = unitTokens.find(
          (token) => (token.cls === "percent" || token.cls === "multiple") && !judged.has(token),
        );
        if (rateToken) {
          judged.add(rateToken);
          if (!formulaResultAgrees(acc, rateToken)) {
            add(
              "NUMERIC_FORMULA_MISMATCH",
              path,
              `明示式の計算結果が表示値と一致しません: ${rateToken.raw}（式の再計算: ${roundForMessage(acc.value)}）: ${path}`,
            );
          }
        }
      }
      i = cursor;
    }

    // --- D-2b: 「AはBのP%」型の割合主張 ---
    for (let i = 0; i < unitTokens.length; i += 1) {
      const percentToken = unitTokens[i];
      if (percentToken.cls !== "percent" || judged.has(percentToken)) continue;
      const denominator = unitTokens[i - 1];
      if (!denominator || judged.has(denominator)) continue;
      if (between(denominator, percentToken).trim() !== "の") continue;
      // 分母と同クラス・同単位の、さらに前のトークンを分子とする。
      let numerator: GroundedNumericToken | undefined;
      for (let j = i - 2; j >= 0; j -= 1) {
        const candidate = unitTokens[j];
        if (candidate.cls === denominator.cls && candidate.unit === denominator.unit) {
          numerator = candidate;
          break;
        }
      }
      if (!numerator || denominator.value === 0) continue;
      // 主張として判定するのは両辺が素材で根拠づく場合のみ。片方が素材に
      // 無い場合はその値自体を未根拠として D-1 で報告し、% は派生で判定する。
      if (!isGrounded(numerator, index) || !isGrounded(denominator, index)) continue;
      judged.add(percentToken);
      const computed = (numerator.value / denominator.value) * 100;
      if (!numbersAgree(computed, percentToken.value)) {
        add(
          "NUMERIC_FORMULA_MISMATCH",
          path,
          `割合の主張が再計算と一致しません: ${percentToken.raw}（再計算: ${roundForMessage(computed)}%）: ${path}`,
        );
      }
    }

    // --- D-1: 残りのトークンの素材照合 ---
    for (const token of unitTokens) {
      if (judged.has(token)) continue;
      if (token.cls === "date") {
        if (token.dateKey !== undefined && referenceKey !== null && token.dateKey === referenceKey) continue;
        if (isGrounded(token, index)) continue;
        if (assumptionSegment) continue;
        add("NUMERIC_NOT_GROUNDED", path, `素材に根拠のない日付です: ${token.raw}: ${path}`);
        continue;
      }
      if (isGrounded(token, index)) continue;
      // 回収期間の主張（「回収」を伴う、または直後に「以内」が続く期間）は
      // 素材金額の比で裏付ける。
      if (
        token.cls === "time"
        && (text.includes("回収") || normalized.slice(token.end, token.end + 4).includes("以内"))
        && isPaybackSupported(token, index)
      ) {
        continue;
      }
      if (assumptionSegment) continue;
      add("NUMERIC_NOT_GROUNDED", path, `素材に根拠のない数値です: ${token.raw}: ${path}`);
    }
  }

  // --- 素材数値の欠落（minor: 成立可否には使わない） ---
  const deckMatch = (sourceToken: GroundedNumericToken): boolean => {
    for (const deckToken of deckTokensAll) {
      if (deckToken.cls !== sourceToken.cls || deckToken.unit !== sourceToken.unit) continue;
      if (sourceToken.cls === "date") {
        if (deckToken.dateKey === sourceToken.dateKey) return true;
        continue;
      }
      const agree = sourceToken.cls === "percent" || sourceToken.cls === "multiple"
        ? numbersAgree
        : valuesVerbatimEqual;
      if (agree(deckToken.value, sourceToken.value)) return true;
    }
    return false;
  };
  const reportedMissing = new Set<string>();
  for (const sourceToken of index.tokens) {
    const key = sourceToken.cls === "date"
      ? `date:${sourceToken.dateKey}`
      : `${classKey(sourceToken.cls, sourceToken.unit)}:${sourceToken.value}`;
    if (reportedMissing.has(key)) continue;
    reportedMissing.add(key);
    if (!deckMatch(sourceToken)) {
      add(
        "SOURCE_NUMERIC_MISSING",
        "numericGrounding",
        `素材の数値が資料に含まれていません: ${sourceToken.raw}`,
      );
    }
  }

  return violations;
}
