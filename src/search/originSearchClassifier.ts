/**
* Rule-based question classification for search grounding (design doc
* SEARCH_GROUNDING_DESIGN_2026-11-07 §2.2, freshness requirements §1.3).
*
* Classification is local and free: no model call is made here. The model-based
* classification fallback from §2.2 is intentionally not implemented; ambiguous
* freshness questions fall to `fresh_general` (the most permissive freshness
* class) so the verification gate, not the classifier, decides whether an
* answer may be grounded.
*/

export type OriginSearchQuestionType =
| "weather"
| "news"
| "market"
| "price_spec"
| "policy"
| "fresh_general"
| "stable"
| "no_search";

export interface OriginSearchFreshnessRequirement {
/** Maximum accepted source age in ms; null means no freshness limit (stable facts). */
maxSourceAgeMs: number | null;
/**
* When true, a source without a parseable publication date can never ground
* the answer (news / market). When false, undated sources may be kept under
* the per-type rules of the grounding gate.
*/
strictPublicationDate: boolean;
tavilyTopic: "general" | "news";
tavilyTimeRange: "day" | "week" | "month" | "year" | null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS: Readonly<
Record<Exclude<OriginSearchQuestionType, "no_search">, OriginSearchFreshnessRequirement>
> = {
// §1.3: weather is "now" data served by a dedicated API; the window only
// bounds how old a retrieved forecast packet may be.
weather: { maxSourceAgeMs: 6 * HOUR_MS, strictPublicationDate: false, tavilyTopic: "general", tavilyTimeRange: null},
// §1.3: breaking news must be hours to a few days old.
news: { maxSourceAgeMs: 3 * DAY_MS, strictPublicationDate: true, tavilyTopic: "news", tavilyTimeRange: "week"},
// §1.3: market data is minutes-to-hours; the search route uses time_range=day.
market: { maxSourceAgeMs: 1 * DAY_MS, strictPublicationDate: true, tavilyTopic: "general", tavilyTimeRange: "day"},
// §1.3: prices / specs / release dates may be days to a few weeks old.
price_spec: { maxSourceAgeMs: 28 * DAY_MS, strictPublicationDate: false, tavilyTopic: "general", tavilyTimeRange: "month"},
// §1.3: policy / fee / legal changes may be weeks to a few months old.
policy: { maxSourceAgeMs: 180 * DAY_MS, strictPublicationDate: false, tavilyTopic: "general", tavilyTimeRange: "year"},
// §1.3 + owner instruction: general "latest information" is capped at 1 year.
fresh_general: { maxSourceAgeMs: 365 * DAY_MS, strictPublicationDate: false, tavilyTopic: "general", tavilyTimeRange: "year"},
// §1.3: stable facts have no freshness limit; authority matters instead.
stable: { maxSourceAgeMs: null, strictPublicationDate: false, tavilyTopic: "general", tavilyTimeRange: null},
};

export interface OriginSearchClassification {
type: OriginSearchQuestionType;
freshness: OriginSearchFreshnessRequirement | null;
/** Minimized query that may be sent to external providers (never the raw text). */
query: string;
/** Extracted place name for the weather type. */
place?: string;
/** Extracted market instruments for the market type (symbols only, no user text). */
instruments?: OriginMarketInstrument[];
/** Identifier of the rule that fired, for tests and diagnostics. */
rule: string;
}

// The standalone 「今」 alternative (S-PR-1 vocabulary reinforcement) is
// fenced by a negative lookahead so discourse / idiom uses that assert no
// currency — 今さら (too late to ask now), 今いち (mediocre), 今や, 今回
// (this time, a discourse reference), 今から / 今すぐ / 今まで (the user's
// own immediate actions and spans) — do not read as freshness markers.
// 今いくつ・今月・今週・今の首相 etc. still match, as do the longer forms.
const FRESHNESS_MARKER =
/(?:最新|現在|直近|最近|今日|今の|今(?![さ]|いち|や|回|後|のち|から|すぐ|まで|にも)|現時点|今年|いま|アップデート|バージョンアップ|発売予定|リリース予定|登場予定|今後|これから)/;
const CONCEPT_MARKER =
/(?:とは|って何|の意味|意味を|定義|歴史|由来|仕組み|読み方|誰が作|いつ作られ|いつからある)/;

function isTransformOnlyRequest(message: string): boolean {
return /(?:この|以下|次の|上記).{0,24}(?:文章|文|資料|内容|テキスト|議事録).{0,40}(?:要約|短く|書き換え|翻訳|校正|修正)/s.test(message)
|| /\b(?:summari[sz]e|shorten|rewrite|translate|proofread)\b.{0,48}\b(?:this|following|provided|above)\b/is.test(message);
}

/**
* Supplied numeric values for the calculation route: an amount or percentage
* the user provided ("12,800円", "10%") or a multiplication of two numbers
* ("500 × 3"). The message is normalized in a single linear pass first —
* NFKC folds full-width digits / ， / ％ to their half-width forms, then
* thousands separators between digits are dropped — so the patterns below
* only ever face a plain digit run followed by a unit, with no overlapping
* quantifiers. The previous single pattern (one digit, then a digit/comma
* run, then the unit) let a long digit run be split between its two
* character classes in O(n) ways and backtracked polynomially when no unit
* followed (CodeQL js/polynomial-redos, alert #928).
*/
function hasSuppliedCalculationValue(message: string): boolean {
const normalized = message.normalize("NFKC").replace(/(\d),(?=\d)/g, "$1");
return /\d+(?:円|%|パーセント)/.test(normalized) || /\d\s*(?:×|\*)\s*\d/.test(normalized);
}

function isDeterministicCalculation(message: string): boolean {
if (FRESHNESS_MARKER.test(message)) return false;
const hasDigits = /[0-9０-９]/.test(message);
const asksCalculation = /(?:計算|合計|平均|中央値|求め|何件|何個|何人|割合は)/.test(message)
|| /\b(?:calculate|compute|total|average|median)\b/i.test(message);
if (hasDigits && asksCalculation) return true;
// Supplied-value result questions (S-PR-1, the H-01 self-destruct shape):
// the user provides the amounts / percentages and asks what they come to
// ("税抜12,800円の商品を3個買うと、消費税10%込みでいくらになりますか").
// That is arithmetic over supplied values, not a price lookup: a supplied
// monetary amount or percentage AND a result-amount cue are both required,
// so a bare "いくらですか" about a product (no supplied values) still
// routes to price_spec below.
const hasSuppliedValue = hasSuppliedCalculationValue(message);
const asksResultAmount = /(?:いくらになります|いくらになる|合計でいくら|総額はいくら)/.test(message);
return hasDigits && hasSuppliedValue && asksResultAmount;
}

function isStablePricingConcept(message: string): boolean {
// Compound / near-adjacent concept shapes only ("価格戦略", "料金のモデル",
// "戦略としての価格"). A product phrase such as "最新モデルの…価格" must not
// match: "モデル" is deliberately excluded from the reverse pattern and the
// windows are kept tight.
return /(?:価格|料金)の?(?:戦略|設計|モデル|理論|弾力性|心理|概念|定義|意味)/.test(message)
|| /(?:戦略|設計|理論|弾力性|心理|概念|定義).{0,4}(?:価格|料金)/s.test(message)
|| /\bpricing?\s+(?:strategy|model|theory|concept|definition)\b/i.test(message);
}

const WEATHER_SIGNAL =
/(?:天気|気温|降水確率|最高気温|最低気温|台風|雨が降|雪が降|weather|forecast)/i;
const MARKET_SIGNAL =
/(?:為替|ドル円|円ドル|ユーロ円|ポンド円|株価|日経平均|ダウ平均|ナスダック|nyダウ|ビットコイン|暗号資産.{0,6}(?:価格|相場)|金価格|原油価格|exchange\s+rate|stock\s+price|btc\s+price)/i;
const NEWS_SIGNAL =
/(?:ニュース|速報|見出し|報道され|試合結果|試合の結果|選挙結果|当選|優勝|breaking\s+news|headlines?|latest\s+news)/i;
const POLICY_SIGNAL =
/(?:政策金利|金利|利上げ|利下げ|物価|人口|統計|平均寿命|最低賃金|児童手当|基礎年金|年金制度|年金.{0,4}額|消費税|税率|所得税|住民税|法改正|法律|制度|補助金|給付金|助成金|介護保険|健康保険.{0,4}(?:料|制度)|雇用保険|\bcpi\b|minimum\s+wage|child\s+benefit|regulation)/i;
const PRICE_SIGNAL =
/(?:価格|値段|料金|いくら|発売日|発売|スペック|仕様|定価|実売|price|release\s+date|specs?)/i;
const PRODUCT_SIGNAL =
/(?:最新|新型|モデル|発売|iphone|ipad|macbook|mac\b|galaxy|pixel|xperia|airpods|apple\s*watch|switch|playstation|ps5|surface|thinkpad|windows|android|chatgpt|gemini|claude|製品|機種|スマホ|パソコン|ノートpc)/i;

export function classifyOriginSearchQuestion(message: string): OriginSearchClassification {
const text = (message?? "").normalize("NFKC").trim();
const done = (
type: OriginSearchQuestionType,
rule: string,
extra?: Partial<OriginSearchClassification>,
): OriginSearchClassification => ({
type,
freshness: type === "no_search"? null: ORIGIN_SEARCH_FRESHNESS_REQUIREMENTS[type],
query: type === "no_search"? "": minimizeOriginSearchQuery(text),
rule,
...extra,
});

if (!text) return done("no_search", "empty");
if (isTransformOnlyRequest(text)) return done("no_search", "transform-only");
if (isDeterministicCalculation(text)) return done("no_search", "deterministic-calculation");

const hasFreshnessMarker = FRESHNESS_MARKER.test(text);
const hasConceptMarker = CONCEPT_MARKER.test(text);

// Historical-fact questions (S-PR-1, the G-01 shape): a question pinned to
// a past point ("消費税が導入された当初の税率は") asks for a fixed fact
// that never changes again, so it is stable — sending it down the policy
// route made the grounding layer shred a directly answerable question
// over unrelated current values. A freshness marker anywhere in the
// question disables this guard (a past-vs-current comparison still
// needs grounding).
if (!hasFreshnessMarker && /(?:当初|当時)/.test(text)) {
return done("stable", "historical-fact");
}

// Weather concept questions ("天気とは") are stable explanations, not forecasts.
if (WEATHER_SIGNAL.test(text) &&!hasConceptMarker) {
return done("weather", "weather-signal", { place: extractOriginWeatherPlace(text)?? undefined});
}
if (MARKET_SIGNAL.test(text) &&!hasConceptMarker) {
return done("market", "market-signal", { instruments: extractOriginMarketInstruments(text) });
}
if (NEWS_SIGNAL.test(text) &&!hasConceptMarker) return done("news", "news-signal");
if (POLICY_SIGNAL.test(text) &&!hasConceptMarker) return done("policy", "policy-signal");
if (isStablePricingConcept(text)) return done("stable", "pricing-concept");
if (PRICE_SIGNAL.test(text) && PRODUCT_SIGNAL.test(text)) return done("price_spec", "price-with-product");
if (hasConceptMarker &&!hasFreshnessMarker) return done("stable", "concept-definition");
if (/(?:百科|ウィキペディア|wikipedia)/i.test(text)) return done("stable", "encyclopedia-request");
if (hasFreshnessMarker) return done("fresh_general", "freshness-marker");
return done("no_search", "default");
}

const MAX_MINIMIZE_INPUT_CHARS = 2_000;
// Bounded repetitions: an unbounded local/domain run makes this pattern
// polynomial on adversarial input (long word-char runs with no dot after "@").
// The bounds follow the RFC limits for addresses (64-char local part, 63-char
// labels), so every realistic address is still matched exactly as before.
const EMAIL_PATTERN = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g;
const URL_PATTERN = /https?:\/\/\S+/g;
const POSTAL_CODE_PATTERN = /〒?\s?\d{3}-\d{4}/g;
const PHONE_LIKE_PATTERN = /(?:\+?\d[\s-]?){10,}/g;
const LONG_DIGIT_RUN_PATTERN = /\d{6,}/g;
const FRAMING_PHRASES: readonly RegExp[] = [
/について教えてください/g,
/について教えて/g,
/について知りたい(?:です)?/g,
/を教えてください/g,
/を教えて/g,
/教えてください/g,
/教えて下さい/g,
/教えて/g,
/知りたい(?:です)?/g,
/調べてください/g,
/調べて/g,
/確認してください/g,
/お願いします/g,
/いただけますか/g,
/でしょうか/g,
/ですか/g,
/ますか/g,
/私の/g,
/私は/g,
/僕の/g,
/俺の/g,
];

/**
* Query minimization (§2.3): external providers receive a shaped search query,
* never the raw user question. Personal data (email addresses, phone-like
* digit sequences, postal codes, long numeric IDs), first-person framing and
* politeness wrappers are stripped deterministically.
*/
export function minimizeOriginSearchQuery(message: string): string {
// Cap the working text before the regex passes below: the shaped query is at
// most 240 chars, and an unbounded input would let backtracking-prone
// patterns (email / phone / digit runs) grow superlinearly on long messages.
let text = (message?? "").normalize("NFKC").slice(0, MAX_MINIMIZE_INPUT_CHARS);
text = text.replace(EMAIL_PATTERN, " ");
text = text.replace(URL_PATTERN, " ");
text = text.replace(POSTAL_CODE_PATTERN, " ");
text = text.replace(PHONE_LIKE_PATTERN, " ");
text = text.replace(LONG_DIGIT_RUN_PATTERN, " ");
for (const phrase of FRAMING_PHRASES) text = text.replace(phrase, " ");
text = text
.replace(/[？?！!。．、,;:：；「」『』（）()\[\]<>＜＞]/g, " ")
.replace(/\s+/g, " ")
.trim();
if (text.length < 2) {
// Fall back to topical terms only (Latin words and Japanese noun runs).
const terms: string[] = [];
for (const match of (message?? "").normalize("NFKC").matchAll(/[a-zA-Z][a-zA-Z0-9._-]{1,}/g)) {
const value = match[0].toLowerCase();
if (!terms.includes(value)) terms.push(value);
}
for (const match of (message?? "").matchAll(/[ァ-ヶー一-龠]{2,}/g)) {
if (!terms.includes(match[0])) terms.push(match[0]);
}
text = terms.slice(0, 10).join(" ");
}
return text.slice(0, 240).trim();
}

const KNOWN_WEATHER_PLACES: readonly string[] = [
"北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬",
"埼玉", "千葉", "東京", "神奈川", "新潟", "富山", "石川", "福井", "山梨", "長野",
"岐阜", "静岡", "愛知", "三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山",
"鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡",
"佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
"札幌", "仙台", "横浜", "川崎", "名古屋", "神戸", "福岡市", "北九州", "那覇", "新宿", "渋谷", "品川", "世田谷",
"ロンドン", "ニューヨーク", "ロサンゼルス", "サンフランシスコ", "シアトル", "ボストン", "シカゴ",
"パリ", "ベルリン", "ソウル", "シンガポール", "シドニー", "トロント", "バンクーバー", "メルボルン",
"バンコク", "台北", "香港",
];

const INTERNATIONAL_PLACE_ALIASES: Readonly<Record<string, string>> = {
"london": "ロンドン",
"new york": "ニューヨーク",
"los angeles": "ロサンゼルス",
"san francisco": "サンフランシスコ",
"seattle": "シアトル",
"boston": "ボストン",
"chicago": "シカゴ",
"paris": "パリ",
"berlin": "ベルリン",
"seoul": "ソウル",
"singapore": "シンガポール",
"sydney": "シドニー",
"toronto": "トロント",
"vancouver": "バンクーバー",
"melbourne": "メルボルン",
"bangkok": "バンコク",
"taipei": "台北",
"hong kong": "香港",
};

const WEATHER_VOCABULARY =
/(?:天気|気温|降水確率|最高気温|最低気温|予報|今日|明日|明後日|今週末|週末|現在|の|は|を|が|教えて|ください|知りたい|雨|雪|晴れ|くもり|曇り|降る|降りますか|必要|傘)/g;

/**
* Extracts the place a weather question is about. Only the place name (never
* the raw message) is sent to the geocoding API.
*/
export function extractOriginWeatherPlace(message: string, userLocation?: unknown): string | null {
if (typeof userLocation === "string" && userLocation.trim().length > 0) {
const place = userLocation.trim().slice(0, 50);
if (!/@/.test(place) &&!/\d{5,}/.test(place)) return place;
}
const text = (message?? "").normalize("NFKC");
for (const place of KNOWN_WEATHER_PLACES) {
if (text.includes(place)) return place === "福岡市"? "福岡": place;
}
const lower = text.toLowerCase();
for (const [alias, canonical] of Object.entries(INTERNATIONAL_PLACE_ALIASES)) {
if (lower.includes(alias)) return canonical;
}
// Heuristic remainder: strip weather vocabulary and keep a short noun phrase.
const remainder = text.replace(WEATHER_VOCABULARY, " ").replace(/[？?！!。．、,\s]+/g, " ").trim();
if (remainder.length >= 2 && remainder.length <= 12 &&!/@/.test(remainder) &&!/\d/.test(remainder)) {
return remainder;
}
return null;
}

/* ------------------------------------------------------------------ */
/* Market instrument extraction (market route, 2026-11-08)             */
/* ------------------------------------------------------------------ */

export type OriginMarketInstrumentKind = "fx" | "index" | "stock" | "crypto" | "commodity";

export interface OriginMarketInstrument {
  /** Provider symbol (Stooq notation). Only this identifier leaves the device. */
  symbol: string;
  /** Japanese display label used in the composed answer. */
  labelJa: string;
  kind: OriginMarketInstrumentKind;
  /** Display unit appended to the value ("" when the value is unitless points). */
  unit: string;
}

interface MarketInstrumentRule {
  pattern: RegExp;
  instrument: OriginMarketInstrument;
}

const MARKET_INSTRUMENT_RULES: readonly MarketInstrumentRule[] = [
  // FX pairs (specific pairs before the generic dollar-yen entries).
  { pattern: /(?:ドル円|円ドル|USD\s*\/?\s*JPY|USDJPY)/i, instrument: { symbol: "usdjpy", labelJa: "ドル円（USD/JPY）", kind: "fx", unit: "円" } },
  { pattern: /(?:ユーロ円|EUR\s*\/?\s*JPY|EURJPY)/i, instrument: { symbol: "eurjpy", labelJa: "ユーロ円（EUR/JPY）", kind: "fx", unit: "円" } },
  { pattern: /(?:ポンド円|GBP\s*\/?\s*JPY|GBPJPY)/i, instrument: { symbol: "gbpjpy", labelJa: "ポンド円（GBP/JPY）", kind: "fx", unit: "円" } },
  { pattern: /(?:豪ドル円|AUD\s*\/?\s*JPY|AUDJPY)/i, instrument: { symbol: "audjpy", labelJa: "豪ドル円（AUD/JPY）", kind: "fx", unit: "円" } },
  { pattern: /(?:ユーロドル|EUR\s*\/?\s*USD|EURUSD)/i, instrument: { symbol: "eurusd", labelJa: "ユーロドル（EUR/USD）", kind: "fx", unit: "ドル" } },
  // Indices.
  { pattern: /(?:日経平均|日経225|日経株価|nikkei)/i, instrument: { symbol: "^NKX", labelJa: "日経平均株価", kind: "index", unit: "円" } },
  { pattern: /(?:NYダウ|ニューヨークダウ|ダウ平均|ダウ工業|dow\s*jones)/i, instrument: { symbol: "^DJI", labelJa: "ダウ平均（NYダウ）", kind: "index", unit: "" } },
  { pattern: /(?:S\s*&\s*P\s*500|S&P|エスアンドピー)/i, instrument: { symbol: "^SPX", labelJa: "S&P 500", kind: "index", unit: "" } },
  { pattern: /(?:ナスダック|nasdaq)/i, instrument: { symbol: "^NDQ", labelJa: "ナスダック総合指数", kind: "index", unit: "" } },
  // Crypto.
  { pattern: /(?:ビットコイン|bitcoin|BTC)/i, instrument: { symbol: "btcusd", labelJa: "ビットコイン（BTC/USD）", kind: "crypto", unit: "ドル" } },
  { pattern: /(?:イーサリアム|ethereum|ETH)/i, instrument: { symbol: "ethusd", labelJa: "イーサリアム（ETH/USD）", kind: "crypto", unit: "ドル" } },
  // Commodities. Bare "金" is too ambiguous; a market-context qualifier is required.
  { pattern: /(?:金価格|ゴールド|金の相場|gold\s+price|XAU)/i, instrument: { symbol: "xauusd", labelJa: "金（XAU/USD）", kind: "commodity", unit: "ドル" } },
  { pattern: /(?:原油価格|原油先物|WTI)/i, instrument: { symbol: "cl.f", labelJa: "原油（WTI先物）", kind: "commodity", unit: "ドル" } },
  // Well-known Japanese listings (name -> TSE code on Stooq, ".jp").
  { pattern: /トヨタ/, instrument: { symbol: "7203.jp", labelJa: "トヨタ自動車（7203）", kind: "stock", unit: "円" } },
  { pattern: /ソニー/, instrument: { symbol: "6758.jp", labelJa: "ソニーグループ（6758）", kind: "stock", unit: "円" } },
  { pattern: /任天堂/, instrument: { symbol: "7974.jp", labelJa: "任天堂（7974）", kind: "stock", unit: "円" } },
  { pattern: /ソフトバンク/, instrument: { symbol: "9984.jp", labelJa: "ソフトバンクグループ（9984）", kind: "stock", unit: "円" } },
  { pattern: /(?:三菱UFJ|MUFG)/i, instrument: { symbol: "8306.jp", labelJa: "三菱UFJフィナンシャル・グループ（8306）", kind: "stock", unit: "円" } },
  { pattern: /キーエンス/, instrument: { symbol: "6861.jp", labelJa: "キーエンス（6861）", kind: "stock", unit: "円" } },
  { pattern: /(?:ファーストリテイリング|ユニクロ)/, instrument: { symbol: "9983.jp", labelJa: "ファーストリテイリング（9983）", kind: "stock", unit: "円" } },
  { pattern: /東京エレクトロン/, instrument: { symbol: "8035.jp", labelJa: "東京エレクトロン（8035）", kind: "stock", unit: "円" } },
  { pattern: /信越化学/, instrument: { symbol: "4063.jp", labelJa: "信越化学工業（4063）", kind: "stock", unit: "円" } },
  { pattern: /日立/, instrument: { symbol: "6501.jp", labelJa: "日立製作所（6501）", kind: "stock", unit: "円" } },
  // Well-known US listings (name -> Stooq ".us" symbol).
  { pattern: /(?:アップル|apple|\bAAPL\b)/i, instrument: { symbol: "aapl.us", labelJa: "アップル（AAPL）", kind: "stock", unit: "ドル" } },
  { pattern: /(?:テスラ|tesla|\bTSLA\b)/i, instrument: { symbol: "tsla.us", labelJa: "テスラ（TSLA）", kind: "stock", unit: "ドル" } },
  { pattern: /(?:エヌビディア|nvidia|\bNVDA\b)/i, instrument: { symbol: "nvda.us", labelJa: "エヌビディア（NVDA）", kind: "stock", unit: "ドル" } },
  { pattern: /(?:マイクロソフト|microsoft|\bMSFT\b)/i, instrument: { symbol: "msft.us", labelJa: "マイクロソフト（MSFT）", kind: "stock", unit: "ドル" } },
  { pattern: /(?:アマゾン|amazon|\bAMZN\b)/i, instrument: { symbol: "amzn.us", labelJa: "アマゾン（AMZN）", kind: "stock", unit: "ドル" } },
  { pattern: /(?:アルファベット|グーグル|google|\bGOOGL?\b)/i, instrument: { symbol: "googl.us", labelJa: "アルファベット（GOOGL）", kind: "stock", unit: "ドル" } },
  { pattern: /(?:メタ|meta\s+platforms|\bMETA\b)/i, instrument: { symbol: "meta.us", labelJa: "メタ（META）", kind: "stock", unit: "ドル" } },
];

const MAX_MARKET_INSTRUMENTS = 5;

/**
 * Extracts the market instruments a question asks about. Only fixed provider
 * symbols are produced — free-form user text is never turned into a symbol,
 * with two bounded exceptions: a 4-digit Japanese listing code in a stock
 * context ("7203の株価") and, as the generic fallback for an FX question
 * that names no pair, USD/JPY (labelled explicitly in the answer, so the
 * assumption is visible rather than hidden). Returns instruments in the
 * order they are mentioned, deduplicated, capped at MAX_MARKET_INSTRUMENTS.
 */
export function extractOriginMarketInstruments(message: string): OriginMarketInstrument[] {
  const text = (message ?? "").normalize("NFKC");
  const found: Array<{ index: number; instrument: OriginMarketInstrument }> = [];
  const seen = new Set<string>();
  const push = (index: number, instrument: OriginMarketInstrument) => {
    if (seen.has(instrument.symbol)) return;
    seen.add(instrument.symbol);
    found.push({ index, instrument });
  };
  for (const rule of MARKET_INSTRUMENT_RULES) {
    const match = rule.pattern.exec(text);
    if (match) push(match.index, rule.instrument);
  }
  // Bounded code form: exactly 4 digits tied to a stock context. Japanese
  // listing codes are 4 characters; Stooq serves them with the ".jp" suffix.
  const codeMatch = text.match(/(\d{4})(?=\s*(?:の|株|株価|の値動き|の現在値))/);
  if (codeMatch && codeMatch.index !== undefined) {
    push(codeMatch.index, {
      symbol: `${codeMatch[1]}.jp`,
      labelJa: `銘柄コード ${codeMatch[1]}（東証）`,
      kind: "stock",
      unit: "円",
    });
  }
  if (found.length === 0 && /(?:為替|ドル|円相場|相場)/.test(text) && /(?:レート|いくら|現在|今|相場)/.test(text)) {
    // An FX question naming no pair is, for a Japanese user, a USD/JPY
    // question in practice; the answer labels the pair explicitly.
    push(0, { symbol: "usdjpy", labelJa: "ドル円（USD/JPY）", kind: "fx", unit: "円" });
  }
  return found
    .sort((a, b) => a.index - b.index)
    .slice(0, MAX_MARKET_INSTRUMENTS)
    .map((entry) => entry.instrument);
}
