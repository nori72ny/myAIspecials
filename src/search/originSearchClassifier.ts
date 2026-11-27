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

import { parseOriginDeterministicDateQuestion } from "./originDeterministicDateAnswer.js";

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
// The bare 「いま」 alternative is fenced the same way (routing
// calibration, 2026-11-16 measurement H-09): unfenced, it matched inside
// the polite verb endings います / いました / いません and turned plain
// arithmetic ("何人いますか") into a freshness demand. The idiom
// continuations いまさら / いまや / いまひとつ / いまにも assert no
// currency either and are fenced off with it.
const FRESHNESS_MARKER =
/(?:最新|現在|直近|最近|今日|今の|今(?![さ]|いち|や|回|後|のち|から|すぐ|まで|にも)|現時点|今年|いま(?![すしせさやひ]|にも)|アップデート|バージョンアップ|発売予定|リリース予定|登場予定|今後|これから)/;
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
const asksResultAmount = /(?:いくらになります|いくらになる|合計でいくら|総額はいくら)/.test(message)
// Derived-price shapes (routing calibration, 2026-11-16 measurement
// H-05 / H-10): the user supplies the discounted / cost values and
// asks back for the original or resulting price ("元の値段はいくら",
// "売値はいくら"). That is the same supplied-value arithmetic with
// the result noun swapped, not a price lookup — a bare product price
// question carries no supplied amount or percentage and still falls
// through to price_spec below.
|| /(?:元の値段|元の価格|元値|売値|定価|原価).{0,4}いくら/.test(message);
if (hasDigits && hasSuppliedValue && asksResultAmount) return true;
// Amount × percentage → result amount (round 7, Q6-01,
// ANSWER_ROUND7_DIAGNOSIS_2026-11-27): "9000万円の6.2%はいくら
// ですか？" supplies every input — an amount (万/億 magnitudes
// included), a percentage (% / パーセント / 割), and the bare
// result-amount ask いくらですか — so it is arithmetic, not a
// price lookup. It slipped past both shapes above: the 万 broke
// the plain amount pattern inside hasSuppliedCalculationValue
// (which demands digits directly against 円), and いくらですか
// was not a result-amount cue. All three parts are required — a
// bare price question supplies neither value, an amount alone is
// a price question, and a percentage alone is a rate question —
// and the freshness guard at the top of this function has
// already run, so a question demanding the CURRENT rate never
// reaches here. The amount / percentage patterns run on the
// NFKC + separator-stripped copy, the same treatment as
// hasSuppliedCalculationValue, so they only ever face a plain
// digit run against a unit (no overlapping quantifiers).
const suppliedValueNormalized = message.normalize("NFKC").replace(/(\d),(?=\d)/g, "$1");
const suppliedMagnitudeAmount = /\d+(?:\.\d+)?\s*(?:億|万)?\s*円/.test(suppliedValueNormalized);
const suppliedPercentage = /\d+(?:\.\d+)?\s*(?:%|パーセント|割)/.test(suppliedValueNormalized);
const asksBareResultAmount = /(?:いくらですか|いくらでしょう)/.test(message);
if (hasDigits && suppliedMagnitudeAmount && suppliedPercentage && asksBareResultAmount) return true;
// Self-contained ratio splits and supplied-rate conversions (routing
// calibration, 2026-11-17 re-measurement H-06 / H-08): the question
// itself supplies every input — an amount plus an explicit ratio to
// split by ("30万円を3対2の割合で分けると、それぞれいくら"), or an
// explicit rate equation plus the amount to convert ("1ドル=150円の
// とき、350ドルは日本円でいくら") — so no external source can add
// anything: the ratio / rate is GIVEN, not looked up. The freshness
// guard at the top of this function has already run, so a question
// demanding the CURRENT rate never reaches here, and a bare price
// question supplies neither a ratio nor a rate equation and still
// falls through to price_spec below.
// The amount patterns run on a copy with thousands separators stripped
// in a single linear pass (the hasSuppliedCalculationValue treatment
// above), so they only ever face a plain digit run plus an optional
// single trailing separator before the unit — no overlapping
// quantifiers (CodeQL js/polynomial-redos). A decimal amount still
// counts, because its final digit run sits next to the unit. The ratio
// check needs only a digit on each side of the separator: a ratio
// number always starts and ends with a digit, so that is the same
// test without quantified number tokens.
const calculationNormalized = message.replace(/(\d),(?=\d)/g, "$1");
const suppliedCurrencyAmount = /\d+[.,]?\s*(?:万|億)?\s*(?:円|ドル|ユーロ|ポンド)/.test(calculationNormalized)
|| /(?:USD|JPY|EUR|GBP)\s*\d|\d+[.,]?\s*(?:USD|JPY|EUR|GBP)/i.test(calculationNormalized);
const ratioSplit = suppliedCurrencyAmount
&& /\d\s*(?:対|:)\s*\d/.test(message)
&& /(?:分け|配分|それぞれ|いくら|何円|何ドル)/.test(message);
const rateEquation = /(?:1\s*(?:ドル|ユーロ|ポンド)\s*=\s*\d[\d,.]*\s*円|1\s*円\s*=\s*\d[\d,.]*\s*(?:ドル|ユーロ|ポンド)|1\s*(?:USD|EUR|GBP)\s*=\s*\d[\d,.]*\s*JPY|1\s*JPY\s*=\s*\d[\d,.]*\s*(?:USD|EUR|GBP))/i.test(message);
const rateConversion = rateEquation
&& /(?:いくら|何円|何ドル|何ユーロ|何ポンド|換算|日本円)/.test(message);
return hasDigits && (ratioSplit || rateConversion);
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

/* ------------------------------------------------------------------ */
/* High-risk categories (R-PR-9b, RPR9_DESIGN_2026-11-15 §R9-B)        */
/* ------------------------------------------------------------------ */

/**
 * High-risk factual categories whose values the model must never assert
 * from memory: tax / public institutions, medical / health standards,
 * product prices / specs, and current officeholders. The R-PR-8
 * re-measurement fatals (B-04/B-06/B-10/E-09) all fell through the fixed
 * signal vocabulary above — B-04 into `stable` via the concept marker
 * 「仕組み」, the other three into the default `no_search` — and were
 * answered on the normal path with wrong institutional values.
 *
 * Detection is deliberately NOT a bare vocabulary patch: a category
 * fires only on a deterministic signal combination — a category name
 * (institution / standard / role / product-category pattern) TOGETHER
 * with a factual-demand marker (a mechanism / limit / standard /
 * amount / age / schedule request, an interrogative numeric unit, a
 * model-number token, or a who-is-the-officeholder shape). Bare names
 * alone do not fire, so definition questions (「ふるさと納税とは」),
 * history questions, basics / how-to requests (「確定申告の基本」) and
 * everyday uses (a recipe using 塩分) keep their existing routes. For
 * institutional categories the design explicitly counts explanation
 * requests (仕組み・目安・基準・上限・期間) as grounded targets: the
 * mechanism explanation is exactly where the wrong values appeared.
 */
export type OriginHighRiskCategory =
| "tax_institution"
| "medical_standard"
| "product_price_spec"
| "incumbent_role"
| "named_entity_event";

/**
 * The institutional bucket covers tax / social-insurance institutions
 * plus, since the routing calibration for the 2026-11-16 measurement,
 * the two neighbouring statutory systems whose tables and rules the
 * model reproduced wrongly from memory on the normal path: labor
 * standards (A-03: the paid-leave grant table of 労働基準法39条 — the
 * vocabulary had no labor term at all) and civil-law rules (E-02: the
 * extinctive-prescription rule of 民法166条, asked as 「時効は何年」
 * with no 法律 token for the policy signal). The name + factual-demand
 * conjunction is unchanged, so how-to and definition shapes stay off
 * the route exactly as before.
 */
const TAX_INSTITUTION_NAME =
/(?:ふるさと納税|確定申告|年末調整|医療費控除|住宅ローン控除|新\s?nisa|\bnisa\b|ideco|つみたて投資枠|成長投資枠|投資枠|国民年金|厚生年金|基礎年金|老齢年金|障害年金|遺族年金|公的年金|年金|健康保険|介護保険|雇用保険|労災保険|社会保険|児童手当|児童扶養手当|出産育児一時金|高額療養費|育児休業給付|失業給付|雇用調整助成金|マイナンバー制度|インボイス制度|消費税|所得税|住民税|固定資産税|相続税|贈与税|法人税|税金|税制|生活保護|有給休暇|年次有給休暇|労働基準法|育児休業|介護休業|民法|時効)/i;
const TAX_INSTITUTION_FACT_MARKER =
/(?:仕組み|目安|基準|上限|下限|自己負担|控除|対象|条件|期間|期限|いくら|どれくらい|どのくらい|何歳|何年|何日|何円|何パーセント|いつから|いつまで|枠|支給|受給|金額|年額|月額|割合)/;

const MEDICAL_STANDARD_NAME =
/(?:予防接種|ワクチン|定期接種|食事摂取基準|摂取基準|塩分|食塩|ナトリウム|血圧|血糖値|コレステロール|中性脂肪|尿酸値|\bbmi\b|タンパク質|食物繊維|カルシウム|鉄分|ビタミン|健康診断|特定健診|妊婦健診|乳幼児健診)/i;
const MEDICAL_STANDARD_FACT_MARKER =
/(?:目安|基準|上限|下限|どれくらい|どのくらい|何g|何グラム|何mg|何kcal|何ml|何リットル|何μg|いつから|いつ頃|何歳から|何か月から|何ヶ月から|何回|スケジュール|時期|推奨|必要量|適量|正常値)/;
const NUMERIC_UNIT_QUESTION =
/(?:何g|何グラム|何mg|何kcal|何ml|何リットル|何μg|何ミリグラム|何キロカロリー)/;
const INTAKE_CONTEXT =
/(?:摂取|飲む|食べる|食事|栄養|水分|健康)/;

const INCUMBENT_ROLE_NAME =
/(?:内閣総理大臣|総理大臣|首相|総理|大統領|副大統領|知事|市長|町長|村長|国王|女王|教皇|事務総長|総裁|議長|大臣)/;
const INCUMBENT_PERSON_MARKER =
/(?:誰|名前|氏名|現職|現在の|今の|何という)/;
const INCUMBENT_PAST_EXCLUSION =
/(?:初代|歴代|元首相|元大統領|元知事|元総理|前首相|前大統領|前知事)/;

/**
 * A quoted proper noun plus an event-date demand (routing calibration,
 * 2026-11-16 measurement I-03): 『みなとみらい環状線』はいつ開業した
 * か asked for the opening date of a line that does not exist, and the
 * normal path fabricated one. The existence / date of a named entity
 * is a fixed fact with a decisive search outcome either way: sources
 * confirm it, or the grounded path finds nothing and the answer holds
 * explicitly instead of inventing a date. The conjunction is narrow
 * on purpose — a quoted name alone (comparisons, quoted product
 * prices, which route earlier anyway) and an event noun alone
 * (ordinary history) do not fire it.
 */
const NAMED_ENTITY_QUOTED = /(?:『[^』]{1,40}』|「[^」]{1,40}」)/;
const NAMED_ENTITY_EVENT_NOUN = /(?:開業|開通|設立|創立|創業|竣工|完成|開館|開局)/;
const NAMED_ENTITY_EVENT_DEMAND = new RegExp(
`(?:いつ|何年|何月).{0,16}${NAMED_ENTITY_EVENT_NOUN.source}|${NAMED_ENTITY_EVENT_NOUN.source}(?:したのは|されたのは|は)(?:いつ|何年|何月)`,
"s",
);

const PRODUCT_CATEGORY_NAME =
/(?:掃除機|冷蔵庫|洗濯機|テレビ|エアコン|電子レンジ|炊飯器|食洗機|ドライヤー|プリンター|モニター|ディスプレイ|キーボード|イヤホン|ヘッドホン|スピーカー|カメラ|レンズ|自動車|バイク|自転車|腕時計|ゲーム機|給湯器|加湿器|空気清浄機|除湿機|扇風機|ヒーター|プロジェクター|ドローン|電動歯ブラシ|シェーバー)/;
/* ReDoS-safe by construction (CodeQL js/polynomial-redos, PR #1294):
   disjoint character classes AND every run length-bounded to real
   model-token sizes. An unbounded letter run followed by a required
   digit rescans quadratically on long digit-less letter strings, and
   a trailing [\w-]* can partition a digit run multiple ways — both
   shapes are banned here. Substring detection is enough —
   "WH-1000XM5" matches via "WH-1", "1000XM5" via "XM5" / "0XM". */
const MODEL_NUMBER_TOKEN =
/(?:[a-z]{2,16}-\d|[a-z]{2,16}\d|\d{1,10}[a-z]{2,16})/i;
const MODEL_NUMBER_LABEL =
/(?:型番|型式|品番)/;

export function detectOriginHighRiskCategory(message: string): OriginHighRiskCategory | null {
const text = (message?? "").normalize("NFKC");
if (TAX_INSTITUTION_NAME.test(text) && TAX_INSTITUTION_FACT_MARKER.test(text)) {
return "tax_institution";
}
if (
(MEDICAL_STANDARD_NAME.test(text) && MEDICAL_STANDARD_FACT_MARKER.test(text))
|| (NUMERIC_UNIT_QUESTION.test(text) && INTAKE_CONTEXT.test(text) && MEDICAL_STANDARD_FACT_MARKER.test(text))
) {
return "medical_standard";
}
if (
PRICE_SIGNAL.test(text)
&& (PRODUCT_CATEGORY_NAME.test(text) || MODEL_NUMBER_TOKEN.test(text) || MODEL_NUMBER_LABEL.test(text))
) {
return "product_price_spec";
}
if (
INCUMBENT_ROLE_NAME.test(text)
&& INCUMBENT_PERSON_MARKER.test(text)
&& !INCUMBENT_PAST_EXCLUSION.test(text)
) {
return "incumbent_role";
}
if (NAMED_ENTITY_QUOTED.test(text) && NAMED_ENTITY_EVENT_DEMAND.test(text)) {
return "named_entity_event";
}
return null;
}

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
// A deterministic DATE question (follow-up measure 1,
// ANSWER_FOLLOWUP_DIAGNOSIS_2026-11-26): the answer is a pure function
// of the clock — a relative day's weekday or date, or the weekday of a
// fully specified date. It needs no source and no freshness judgement;
// without this guard the bare 今日 fell into the freshness-marker rule
// below and the fresh_general wipe refused a question the calendar
// answers exactly (production-observed 2026-11-25 and 2026-11-26).
// The parser is whole-question strict, so 今日のニュース / 今日の天気 /
// 今日は何日までにやるべき？ never land here.
if (parseOriginDeterministicDateQuestion(text)) return done("no_search", "deterministic-date");

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
// FX rate / conversion questions the market signal's fixed pair
// vocabulary misses ("1ドル何円", "100ドルは日本円でいくら") are market
// questions too when the deterministic FX parser resolves them to a
// currency pair. Placed after the deterministic-calculation guard
// above, so a question that SUPPLIES its rate ("1ドル=150円のとき…")
// stays a no-search calculation, and after the weather route, whose
// signal never co-occurs with a currency pair.
if (!hasConceptMarker && parseOriginFxRequest(text)) {
return done("market", "fx-signal", { instruments: extractOriginMarketInstruments(text) });
}
if (MARKET_SIGNAL.test(text) &&!hasConceptMarker) {
return done("market", "market-signal", { instruments: extractOriginMarketInstruments(text) });
}
if (NEWS_SIGNAL.test(text) &&!hasConceptMarker) return done("news", "news-signal");
if (POLICY_SIGNAL.test(text) &&!hasConceptMarker) return done("policy", "policy-signal");
if (isStablePricingConcept(text)) return done("stable", "pricing-concept");
if (PRICE_SIGNAL.test(text) && PRODUCT_SIGNAL.test(text)) return done("price_spec", "price-with-product");
// High-risk categories (R-PR-9b): placed after the transform /
// calculation / historical guards and after every established signal
// route, but BEFORE the two fall-throughs that produced the R-PR-8
// fatals — the concept-definition `stable` (B-04's 「仕組み」 shape) and
// the default `no_search` (B-06/B-10/E-09). A category match inverts
// the default for institutional / numeric facts: they go to the
// grounded path with the matching freshness profile (policy for
// institutions and health standards, price_spec for product prices,
// fresh_general for current officeholders) instead of being asserted
// from model memory on the normal path.
const highRiskCategory = detectOriginHighRiskCategory(text);
if (highRiskCategory === "tax_institution") return done("policy", "high-risk-tax-institution");
if (highRiskCategory === "medical_standard") return done("policy", "high-risk-medical-standard");
if (highRiskCategory === "product_price_spec") return done("price_spec", "high-risk-product-price-spec");
if (highRiskCategory === "incumbent_role") return done("fresh_general", "high-risk-incumbent-role");
// A named entity's event date is a fixed fact: it classifies as
// stable, and the response policy promotes exactly this category (and
// past-pinned officeholders) from stable to the grounded path — see
// requiresOriginCurrentInformation. Stable alone does not ground;
// definitions and timeless history keep the direct path.
if (highRiskCategory === "named_entity_event") return done("stable", "high-risk-named-entity-event");
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

/* ------------------------------------------------------------------ */
/* FX rate / conversion request parsing (Frankfurter route)            */
/* ------------------------------------------------------------------ */

/**
 * The currencies the deterministic FX route serves: the Frankfurter
 * reference set's majors plus the Asian currencies a Japanese user
 * asks about. Only these fixed codes are ever sent to the provider —
 * free-form user text is never turned into a currency code.
 */
export type OriginFxCurrencyCode =
  | "JPY" | "USD" | "EUR" | "GBP" | "AUD" | "CHF" | "CAD"
  | "CNY" | "KRW" | "HKD" | "NZD" | "SGD" | "THB";

export interface OriginFxRequest {
  /** Source currency: the rate is "1 base = rate quote". */
  base: OriginFxCurrencyCode;
  /** Target currency the rate (and any conversion) is expressed in. */
  quote: OriginFxCurrencyCode;
  /** Amount of base currency to convert, when the question names one. */
  amount: number | null;
  /**
   * Specific past date asked for (YYYY-MM-DD); null asks for the
   * latest published rate. Frankfurter answers a non-business day
   * with the most recent business day's rate and reports that date,
   * which the composed answer states verbatim.
   */
  date: string | null;
}

const FX_CURRENCY_CODES: readonly OriginFxCurrencyCode[] = [
  "JPY", "USD", "EUR", "GBP", "AUD", "CHF", "CAD", "CNY", "KRW", "HKD", "NZD", "SGD", "THB",
];

/**
 * Japanese currency names, longest first within each code so the
 * overlap resolution keeps 豪ドル (AUD) over the ドル (USD) inside it
 * and 日本円 (JPY) over the bare 円.
 */
const FX_CURRENCY_NAMES: ReadonlyArray<{ code: OriginFxCurrencyCode; name: string }> = [
  { code: "NZD", name: "ニュージーランドドル" },
  { code: "AUD", name: "オーストラリアドル" },
  { code: "SGD", name: "シンガポールドル" },
  { code: "USD", name: "アメリカドル" },
  { code: "CAD", name: "カナダドル" },
  { code: "HKD", name: "香港ドル" },
  { code: "USD", name: "米ドル" },
  { code: "AUD", name: "豪ドル" },
  { code: "GBP", name: "英ポンド" },
  { code: "CNY", name: "人民元" },
  { code: "CNY", name: "中国元" },
  { code: "KRW", name: "韓国ウォン" },
  { code: "CHF", name: "スイスフラン" },
  { code: "THB", name: "タイバーツ" },
  { code: "JPY", name: "日本円" },
  { code: "EUR", name: "ユーロ" },
  { code: "GBP", name: "ポンド" },
  { code: "CHF", name: "フラン" },
  { code: "KRW", name: "ウォン" },
  { code: "THB", name: "バーツ" },
  { code: "USD", name: "ドル" },
  { code: "JPY", name: "円" },
];

/**
 * Explicit pair tokens, Japanese and ISO, checked before the generic
 * mention scan. Longest first: 豪ドル円 contains ドル円 as a substring
 * and must win over it.
 */
const FX_PAIR_TOKENS: ReadonlyArray<{ pattern: RegExp; base: OriginFxCurrencyCode; quote: OriginFxCurrencyCode }> = [
  { pattern: /豪ドル円/, base: "AUD", quote: "JPY" },
  { pattern: /ユーロドル/, base: "EUR", quote: "USD" },
  { pattern: /ユーロ円/, base: "EUR", quote: "JPY" },
  { pattern: /ポンド円/, base: "GBP", quote: "JPY" },
  { pattern: /ドル円/, base: "USD", quote: "JPY" },
  { pattern: /円ドル/, base: "JPY", quote: "USD" },
];

/**
 * A rate / conversion demand. Deliberately narrower than the market
 * instrument fallback's: bare politeness (教えて) does not make a
 * lone currency mention a rate question.
 */
const FX_DEMAND =
  /(?:レート|いくら|何円|何ドル|何ユーロ|何ポンド|何ウォン|換算|両替|相場|現在|今の|今日の|最新の)/;

/**
 * A supplied rate equation ("1ドル=150円のとき") makes the question a
 * self-contained calculation, not a lookup — the classifier's
 * deterministic-calculation guard owns it, and the FX route must not
 * re-interpret it as a request for the current rate.
 */
const FX_SUPPLIED_RATE_EQUATION =
  /(?:1\s*(?:ドル|ユーロ|ポンド)\s*=\s*\d|1\s*円\s*=\s*\d|1\s*(?:USD|EUR|GBP)\s*=\s*\d|1\s*JPY\s*=\s*\d)/i;

interface FxCurrencyMention {
  code: OriginFxCurrencyCode;
  index: number;
  /** Amount written directly before this mention ("100ドル"), if any. */
  amount: number | null;
}

function fxAmountBefore(text: string, index: number): number | null {
  const head = text.slice(Math.max(0, index - 20), index);
  const match = head.match(/(\d[\d,]*(?:\.\d+)?)\s*(万|億)?\s*$/);
  if (!match) return null;
  const value = Number((match[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = match[2] === "万" ? 10_000 : match[2] === "億" ? 100_000_000 : 1;
  const amount = value * multiplier;
  return Number.isFinite(amount) && amount <= 1e15 ? amount : null;
}

function scanFxCurrencyMentions(text: string): FxCurrencyMention[] {
  const raw: Array<{ code: OriginFxCurrencyCode; index: number; length: number }> = [];
  for (const { code, name } of FX_CURRENCY_NAMES) {
    let from = 0;
    for (;;) {
      const index = text.indexOf(name, from);
      if (index < 0) break;
      raw.push({ code, index, length: name.length });
      from = index + name.length;
    }
  }
  for (const match of text.matchAll(/\b(USD|JPY|EUR|GBP|AUD|CHF|CAD|CNY|KRW|HKD|NZD|SGD|THB)\b/gi)) {
    raw.push({ code: match[1]!.toUpperCase() as OriginFxCurrencyCode, index: match.index, length: match[1]!.length });
  }
  // Longest match wins at any position (豪ドル over ドル, 日本円 over 円);
  // overlapping shorter matches inside an accepted span are dropped.
  raw.sort((a, b) => a.index - b.index || b.length - a.length);
  const mentions: FxCurrencyMention[] = [];
  let coveredUntil = -1;
  for (const candidate of raw) {
    if (candidate.index < coveredUntil) continue;
    coveredUntil = candidate.index + candidate.length;
    mentions.push({
      code: candidate.code,
      index: candidate.index,
      amount: fxAmountBefore(text, candidate.index),
    });
  }
  return mentions;
}

function fxTokyoDateString(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

function fxShiftDateString(dateString: string, deltaDays: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

/**
 * The date an FX question asks about, as YYYY-MM-DD; null for
 * "latest". An explicit date that is not a real calendar date, lies
 * in the future, or predates the provider's history (1948) makes the
 * whole request unparseable (undefined sentinel via `invalid`), so
 * the caller falls through instead of silently answering with a
 * different day's rate.
 */
function parseFxDate(text: string, nowMs: number): { date: string | null; invalid: boolean } {
  const today = fxTokyoDateString(nowMs);
  const explicit = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/) ?? text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (explicit) {
    const year = Number(explicit[1]);
    const month = Number(explicit[2]);
    const day = Number(explicit[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    const real = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
    const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!real || date > today || date < "1948-01-01") return { date: null, invalid: true };
    return { date, invalid: false };
  }
  // 一昨日 contains 昨日 as a substring, so it is checked first.
  if (/(?:一昨日|おととい)/.test(text)) return { date: fxShiftDateString(today, -2), invalid: false };
  if (/昨日/.test(text)) return { date: fxShiftDateString(today, -1), invalid: false };
  return { date: null, invalid: false };
}

/**
 * Parses a question into the deterministic FX route's request, or
 * null when the question is not an FX rate / conversion question this
 * route can serve exactly. Only fixed currency codes, an optional
 * amount, and an optional date are extracted — the provider request
 * is built from these alone, so no user text ever leaves the server.
 *
 * Shapes served: an explicit pair ("ドル円はいくら", "ユーロ円の
 * レート"), a "1 X = ? Y" ask ("1ドル何円？"), an amount conversion
 * ("100ドルは日本円でいくら", "50ユーロを円に換算して"), a single
 * currency against the yen default ("ユーロのレートは？"), a bare
 * 為替 question (USD/JPY, labelled as such in the answer, mirroring
 * the market route's standing fallback), each optionally pinned to a
 * date ("2024年1月5日のドル円", "昨日のユーロ円").
 */
export function parseOriginFxRequest(message: string, nowMs: number = Date.now()): OriginFxRequest | null {
  const text = (message ?? "").normalize("NFKC").trim();
  if (!text) return null;
  if (FX_SUPPLIED_RATE_EQUATION.test(text)) return null;
  const { date, invalid } = parseFxDate(text, nowMs);
  if (invalid) return null;
  const demand = FX_DEMAND.test(text);

  for (const token of FX_PAIR_TOKENS) {
    const match = token.pattern.exec(text);
    if (!match) continue;
    // The amount belongs to the base currency wherever it is written:
    // directly before the pair token ("100ドル円") or before a later
    // mention of the base ("ドル円で、100ドルはいくら").
    const amount = fxAmountBefore(text, match.index)
      ?? scanFxCurrencyMentions(text).find((mention) => mention.code === token.base && mention.amount !== null)?.amount
      ?? null;
    return { base: token.base, quote: token.quote, amount, date };
  }
  const isoPair = text.match(/\b(USD|JPY|EUR|GBP|AUD|CHF|CAD|CNY|KRW|HKD|NZD|SGD|THB)\s*\/\s*(USD|JPY|EUR|GBP|AUD|CHF|CAD|CNY|KRW|HKD|NZD|SGD|THB)\b/i)
    ?? text.match(/\b(USD|EUR|GBP|AUD|CHF|CAD|CNY|KRW|HKD|NZD|SGD|THB)(JPY|USD|EUR|GBP|AUD|CHF|CAD|CNY|KRW|HKD|NZD|SGD|THB)\b/i);
  if (isoPair) {
    const base = isoPair[1]!.toUpperCase() as OriginFxCurrencyCode;
    const quote = isoPair[2]!.toUpperCase() as OriginFxCurrencyCode;
    if (base !== quote && FX_CURRENCY_CODES.includes(base) && FX_CURRENCY_CODES.includes(quote)) {
      return { base, quote, amount: fxAmountBefore(text, isoPair.index ?? 0), date };
    }
  }

  const mentions = scanFxCurrencyMentions(text);
  const distinct: OriginFxCurrencyCode[] = [];
  for (const mention of mentions) {
    if (!distinct.includes(mention.code)) distinct.push(mention.code);
  }

  if (distinct.length >= 2) {
    const amountMention = mentions.find((mention) => mention.amount !== null);
    if (!amountMention && !demand) return null;
    // The currency carrying the amount is what gets converted; with
    // no amount, mention order decides ("ユーロとドルのレート").
    const base = amountMention ? amountMention.code : distinct[0]!;
    const quote = distinct.find((code) => code !== base)!;
    return { base, quote, amount: amountMention && amountMention.code === base ? amountMention.amount : null, date };
  }

  if (distinct.length === 1) {
    const only = distinct[0]!;
    if (only === "JPY") {
      // A yen-only mention is a rate question only in an explicit FX
      // framing ("円相場", "為替"); the pair is then USD/JPY, the
      // standing default, and the answer labels it explicitly.
      if (/(?:為替|円相場)/.test(text) && demand) return { base: "USD", quote: "JPY", amount: null, date };
      return null;
    }
    if (!demand) return null;
    const amount = mentions.find((mention) => mention.code === only)?.amount ?? null;
    return { base: only, quote: "JPY", amount, date };
  }

  // No currency named at all: a bare 為替 question is USD/JPY (the
  // market route's standing fallback, labelled in the answer).
  if (/(?:為替)/.test(text) && demand) return { base: "USD", quote: "JPY", amount: null, date };
  return null;
}
