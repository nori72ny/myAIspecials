import type { OriginRequestIntent } from "./OriginRequestIntent.js";

// Business planning & marketing capability for chat answers.
//
// Design canon: BUSINESS_CAPABILITY_PROGRAM_2026-11-13.md §2.1 (marketing
// playbook), §3 (the four "beyond the request" actions), §3.5 (hard
// boundaries: no fabricated numbers, every placeholder labelled).
//
// The chat-side shape of the capability is three deterministic pieces:
//  1. detection — classify a planning/marketing request into a kind so the
//     matching playbook (型) is applied;
//  2. figure parsing + funnel backcast — numbers the user actually supplied
//     are extracted and the reverse calculation (goal -> orders -> meetings
//     -> SQL -> MQL -> leads -> reach) is computed by code, never by the
//     model, so the arithmetic in the answer can be exact;
//  3. the instruction — the playbook structure, the assumption-labelling
//     discipline, and the §3 actions, appended to the answer quality policy
//     instruction by OriginAnswerQualityPolicy when a kind is detected.
//
// Nothing here creates a new route or a paid element: the instruction rides
// on the existing quality-policy section of the chat system prompt.

export type OriginBusinessPlanningKind =
  | "marketing-spec"
  | "funnel-design"
  | "market-competition"
  | "campaign-plan"
  | "promotion-ideas"
  | "proposal-outline"
  | "marketing-plan";

export interface OriginBusinessPlanningFigures {
  /** User-supplied revenue goal, in yen. */
  goalRevenueYen?: number;
  /** User-supplied order/contract count goal. */
  goalOrders?: number;
  /** User-supplied average unit price, in yen. */
  unitPriceYen?: number;
  /** User-supplied meeting -> order conversion rate (0-1). */
  meetingToOrderRate?: number;
  /** User-supplied SQL -> meeting conversion rate (0-1). */
  sqlToMeetingRate?: number;
}

export interface OriginFunnelBackcastStage {
  stage: "orders" | "meetings" | "sql" | "mql" | "leads" | "reach";
  count: number;
  /** Rate used to derive this stage from the next one, when a rate was used. */
  derivedWithRate?: number;
}

export interface OriginFunnelBackcast {
  stages: OriginFunnelBackcastStage[];
  /** Earliest derived stage recomputed with every used rate halved. */
  sensitivity: { stage: OriginFunnelBackcastStage["stage"]; baseCount: number; halvedRateCount: number } | null;
}

export interface OriginBusinessPlanningProfile {
  kind: OriginBusinessPlanningKind;
  figures: OriginBusinessPlanningFigures;
  backcast: OriginFunnelBackcast | null;
}

const KIND_RULES: readonly { kind: OriginBusinessPlanningKind; patterns: readonly RegExp[] }[] = [
  {
    kind: "marketing-spec",
    patterns: [
      /(?:マーケティング|マーケ|キャンペーン).{0,6}仕様書/,
      /マーケティング仕様/,
      /\bmarketing (?:spec|specification)\b/i,
    ],
  },
  {
    kind: "funnel-design",
    patterns: [
      /ファネル(?:の)?(?:設計|構築|計画)/,
      /ファネルを(?:設計|作|組み立て)/,
      /リード\s*(?:→|->|から)\s*MQL/i,
      /\bfunnel (?:design|planning)\b/i,
    ],
  },
  {
    kind: "market-competition",
    patterns: [
      /(?:市場|競合)(?:の|を)?(?:分析|調査)/,
      /市場規模|市場参入|競合他社|ポジショニング/,
      /\b(?:market|competitive|competitor) analysis\b/i,
    ],
  },
  {
    kind: "campaign-plan",
    patterns: [
      /(?:キャンペーン|プロモーション)(?:の)?(?:計画|企画|設計|案)/,
      /キャンペーンを(?:考え|作|企画|計画|立案)/,
      /販促キャンペーン/,
      /\bcampaign plan(?:ning)?\b/i,
    ],
  },
  {
    kind: "promotion-ideas",
    patterns: [
      /販促(?:案|企画|施策)/,
      /集客(?:案|施策|を増やす)/,
      /販促を(?:考え|提案)/,
      /\bpromotion ideas?\b/i,
    ],
  },
  {
    kind: "proposal-outline",
    patterns: [
      /企画書|事業企画|企画案/,
      /企画を(?:考え|立て|立案)/,
      /新規事業.{0,12}企画/,
      /\bbusiness proposal\b|\bproposal outline\b/i,
    ],
  },
  {
    kind: "marketing-plan",
    patterns: [
      /マーケティング(?:の)?(?:計画|戦略|施策|プラン)/,
      /マーケティング戦略/,
      /\bmarketing (?:plan|strategy)\b/i,
    ],
  },
];

// Pure definition/explanation questions ("マーケティングとは何ですか") are
// knowledge questions, not planning requests: the playbook must not fire.
const DEFINITION_QUESTION = /(?:とは)(?:何|なに|どういう)/;

export function detectOriginBusinessPlanningKind(
  input: string,
  _intent?: OriginRequestIntent,
): OriginBusinessPlanningKind | null {
  const text = input.trim();
  if (!text || DEFINITION_QUESTION.test(text)) return null;
  for (const rule of KIND_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.kind;
  }
  // Numeric-goal planning fallback: an explicit sales/order goal combined
  // with a request to plan or back-calculate is a planning request even
  // without a marketing keyword (e.g. 「売上目標は6,000万円…逆算して達成
  // 計画を立てて」). The goal must be a labelled figure, not a bare number.
  if (/(?:達成計画|逆算|計画を立て)/.test(text)) {
    const figures = parseBusinessPlanningFigures(text);
    if (typeof figures.goalRevenueYen === "number" || typeof figures.goalOrders === "number") {
      return "campaign-plan";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Figure parsing: only explicitly labelled numbers are taken. A bare number
// in the text is never treated as a goal or a rate.
// ---------------------------------------------------------------------------

function normalizeNumericText(text: string): string {
  return text
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[，、]/g, ",")
    .replace(/．/g, ".");
}

const YEN_UNITS: Record<string, number> = { "億円": 1e8, "万円": 1e4, "千円": 1e3, "円": 1, "億": 1e8, "万": 1e4 };

function parseYenAmount(rawNumber: string, unit: string | undefined): number | null {
  const value = Number(rawNumber.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  const multiplier = unit ? YEN_UNITS[unit] ?? 1 : 1;
  return value * multiplier;
}

function firstMatch(text: string, patterns: readonly RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

const AMOUNT = "([0-9][0-9,]*\\.?[0-9]*)";
const YEN_UNIT = "(億円|万円|千円|円|億|万)?";

export function parseBusinessPlanningFigures(input: string): OriginBusinessPlanningFigures {
  const text = normalizeNumericText(input);
  const figures: OriginBusinessPlanningFigures = {};

  const goalRevenue = firstMatch(text, [
    new RegExp(`(?:目標売上|売上目標|目標金額|売上高目標)(?:は|が|を|：|:|\\s)*${AMOUNT}\\s*${YEN_UNIT}`),
    new RegExp(`売上(?:目標)?(?:は|を)?\\s*${AMOUNT}\\s*(億円|万円|千円|円)(?:を|に)?(?:目標|目指)`),
  ]);
  if (goalRevenue) {
    const yen = parseYenAmount(goalRevenue[1], goalRevenue[2]);
    if (yen !== null) figures.goalRevenueYen = yen;
  }

  const goalOrders = firstMatch(text, [
    new RegExp(`(?:目標)?(?:受注|契約|販売)(?:件数|数)?(?:の)?目標(?:は|：|:|\\s)*${AMOUNT}\\s*件`),
    new RegExp(`受注(?:は|を)?\\s*${AMOUNT}\\s*件(?:を|が)?(?:目標|目指)`),
    new RegExp(`目標(?:は|：|:)?\\s*(?:受注|契約|販売)\\s*${AMOUNT}\\s*件`),
  ]);
  if (goalOrders) {
    const count = Number(goalOrders[1].replace(/,/g, ""));
    if (Number.isFinite(count) && count > 0) figures.goalOrders = Math.round(count);
  }

  const unitPrice = firstMatch(text, [
    new RegExp(`(?:平均単価|客単価|商品単価|単価)(?:は|が|：|:|\\s)*${AMOUNT}\\s*${YEN_UNIT}`),
  ]);
  if (unitPrice) {
    const yen = parseYenAmount(unitPrice[1], unitPrice[2]);
    if (yen !== null) figures.unitPriceYen = yen;
  }

  const meetingToOrder = firstMatch(text, [
    /(?:成約率|受注率|クロージング率)(?:は|が|：|:|\s)*([0-9]+\.?[0-9]*)\s*(?:%|％|パーセント)/,
  ]);
  if (meetingToOrder) {
    const rate = Number(meetingToOrder[1]) / 100;
    if (rate > 0 && rate <= 1) figures.meetingToOrderRate = rate;
  }

  const sqlToMeeting = firstMatch(text, [
    /(?:商談化率|アポ率|面談化率|面談率)(?:は|が|：|:|\s)*([0-9]+\.?[0-9]*)\s*(?:%|％|パーセント)/,
  ]);
  if (sqlToMeeting) {
    const rate = Number(sqlToMeeting[1]) / 100;
    if (rate > 0 && rate <= 1) figures.sqlToMeetingRate = rate;
  }

  return figures;
}

// ---------------------------------------------------------------------------
// Deterministic funnel backcast. Standard stage vocabulary (canon §2.1):
// リーチ -> リード -> MQL -> SQL -> 商談 -> 受注. Derivation walks backwards
// from the order goal through the rates that were actually supplied and
// stops at the first missing rate — it never invents a rate.
// ---------------------------------------------------------------------------

export interface OriginFunnelRates {
  meetingToOrder?: number;
  sqlToMeeting?: number;
  mqlToSql?: number;
  leadToMql?: number;
  reachToLead?: number;
}

const BACKWARD_STEPS: readonly { stage: OriginFunnelBackcastStage["stage"]; rateKey: keyof OriginFunnelRates }[] = [
  { stage: "meetings", rateKey: "meetingToOrder" },
  { stage: "sql", rateKey: "sqlToMeeting" },
  { stage: "mql", rateKey: "mqlToSql" },
  { stage: "leads", rateKey: "leadToMql" },
  { stage: "reach", rateKey: "reachToLead" },
];

export function computeFunnelBackcast(
  figures: OriginBusinessPlanningFigures,
  extraRates: OriginFunnelRates = {},
): OriginFunnelBackcast | null {
  let orders: number | null = null;
  if (typeof figures.goalOrders === "number" && figures.goalOrders > 0) {
    orders = Math.ceil(figures.goalOrders);
  } else if (
    typeof figures.goalRevenueYen === "number" && figures.goalRevenueYen > 0
    && typeof figures.unitPriceYen === "number" && figures.unitPriceYen > 0
  ) {
    orders = Math.ceil(figures.goalRevenueYen / figures.unitPriceYen);
  }
  if (orders === null) return null;

  const rates: OriginFunnelRates = {
    meetingToOrder: figures.meetingToOrderRate ?? extraRates.meetingToOrder,
    sqlToMeeting: figures.sqlToMeetingRate ?? extraRates.sqlToMeeting,
    mqlToSql: extraRates.mqlToSql,
    leadToMql: extraRates.leadToMql,
    reachToLead: extraRates.reachToLead,
  };

  const stages: OriginFunnelBackcastStage[] = [{ stage: "orders", count: orders }];
  const usedRates: number[] = [];
  let current = orders;
  for (const step of BACKWARD_STEPS) {
    const rate = rates[step.rateKey];
    if (typeof rate !== "number" || rate <= 0 || rate > 1) break;
    current = Math.ceil(current / rate);
    stages.push({ stage: step.stage, count: current, derivedWithRate: rate });
    usedRates.push(rate);
  }

  let sensitivity: OriginFunnelBackcast["sensitivity"] = null;
  if (usedRates.length > 0) {
    let halved = orders;
    for (const rate of usedRates) halved = Math.ceil(halved / (rate / 2));
    const earliest = stages[stages.length - 1];
    sensitivity = { stage: earliest.stage, baseCount: earliest.count, halvedRateCount: halved };
  }

  return { stages, sensitivity };
}

export function resolveOriginBusinessPlanning(input: string, intent?: OriginRequestIntent): OriginBusinessPlanningProfile | null {
  const kind = detectOriginBusinessPlanningKind(input, intent);
  if (!kind) return null;
  const figures = parseBusinessPlanningFigures(input);
  const backcast = computeFunnelBackcast(figures);
  return { kind, figures, backcast };
}

// ---------------------------------------------------------------------------
// Instruction (the 型). Appended by the answer quality policy only when a
// planning/marketing kind was detected; all other answers are byte-identical
// to before.
// ---------------------------------------------------------------------------

const STAGE_LABEL_JA: Record<OriginFunnelBackcastStage["stage"], string> = {
  orders: "受注",
  meetings: "商談",
  sql: "SQL",
  mql: "MQL",
  leads: "リード",
  reach: "リーチ",
};

function formatYen(value: number): string {
  return `${value.toLocaleString("ja-JP")}円`;
}

function formatBackcastBlock(profile: OriginBusinessPlanningProfile): string[] {
  const { figures, backcast } = profile;
  const lines: string[] = [];
  const supplied: string[] = [];
  if (typeof figures.goalRevenueYen === "number") supplied.push(`revenue goal ${formatYen(figures.goalRevenueYen)}`);
  if (typeof figures.goalOrders === "number") supplied.push(`order goal ${figures.goalOrders}件`);
  if (typeof figures.unitPriceYen === "number") supplied.push(`average unit price ${formatYen(figures.unitPriceYen)}`);
  if (typeof figures.meetingToOrderRate === "number") supplied.push(`meeting->order rate ${Math.round(figures.meetingToOrderRate * 1000) / 10}%`);
  if (typeof figures.sqlToMeetingRate === "number") supplied.push(`SQL->meeting rate ${Math.round(figures.sqlToMeetingRate * 1000) / 10}%`);
  if (supplied.length > 0) {
    lines.push(`- User-supplied figures (treat as given facts, do not alter them): ${supplied.join("; ")}.`);
  }
  if (backcast) {
    const chain = backcast.stages
      .map((stage) => `${STAGE_LABEL_JA[stage.stage]} ${stage.count.toLocaleString("ja-JP")}件`)
      .join(" <- ");
    lines.push(`- Deterministic backcast computed by the system from those figures (use these exact counts; do not recompute, round differently, or substitute your own arithmetic): ${chain}.`);
    if (backcast.sensitivity) {
      lines.push(`- Sensitivity of that backcast: if every conversion rate above halved, the required ${STAGE_LABEL_JA[backcast.sensitivity.stage]} would rise from ${backcast.sensitivity.baseCount.toLocaleString("ja-JP")} to ${backcast.sensitivity.halvedRateCount.toLocaleString("ja-JP")}. State this kind of sensitivity next to the backcast.`);
    }
  }
  return lines;
}

const KIND_EMPHASIS: Record<OriginBusinessPlanningKind, string> = {
  "marketing-spec": "Shape the answer as a specification: purpose, target, current state and premises, funnel design, channel plan, measures and content plan, KPI definitions, measurement method (fix the MQL/SQL判定条件, the aggregation period, the data source, and one attribution model; include channel identifier naming such as UTM rules), schedule and ownership, risks and alternatives. A reader must be able to execute from it without a follow-up meeting.",
  "funnel-design": "Define every funnel stage by observable entry and exit criteria — especially the MQL and SQL判定条件 — before assigning any rate. Give each stage its own KPI and measurement definition. Rates without a stage definition are meaningless; say so if a stage cannot be defined from what was supplied.",
  "market-competition": "Frame competitors in three classes — direct, indirect, and substitute behaviour — and end with an explicit positioning statement (for whom, against what alternative, on which decisive difference). Every market size or share figure needs a checked source with its date; a figure you cannot source must be labelled as an estimate （推定） or omitted. Never state an unsourced market number as fact.",
  "campaign-plan": "Fix the period, the offer, and the channel mix up front, and tie every measure to the funnel stage it moves. If a budget is given, treat it as a hard constraint and show the split by channel; if none is given, label any cost figure as an assumption. Sequence the measures on a timeline with owners.",
  "promotion-ideas": "Give each idea the same four parts: who it targets, the mechanism, the cost feel against any stated budget, and how its effect will be measured. Rank the ideas by expected effect x certainty / effort and put the ranking first; do not present an unordered idea dump. Respect a stated budget as a hard constraint.",
  "proposal-outline": "Return the outline itself as the deliverable: open with who decides what and by when (the decision-maker framing), then the chapter list; under each chapter state the single claim it must land and the evidence or material needed to support it. Do not write the full proposal body unless asked — the outline plus what each chapter must prove is the sharp deliverable.",
  "marketing-plan": "Cover the full standard structure below; where the request is narrow, keep the structure but compress the parts that do not bind the decision.",
};

export function buildOriginBusinessPlanningInstruction(profile: OriginBusinessPlanningProfile): string {
  return [
    "Business planning & marketing protocol (a planning/marketing request was detected; apply this playbook):",
    `- Request kind: ${profile.kind}. ${KIND_EMPHASIS[profile.kind]}`,
    "- Structure the answer in this order, using headings in the user's language: 目的とゴール (state the higher purpose behind the request in one line — if you inferred it, say it is your reading; write the goal in SMART form) / 対象 (who it is for: the ICP or persona defined by their problem and decision conditions, not demographics alone) / 提供価値 (the value against that problem, and the decisive difference from alternatives) / 市場・競合の見立て (facts need sources; label estimates as estimates) / 施策とチャネル (every measure tied to the funnel stage it moves) / 数値の逆算 / KPIと計測方法 / リスクと代替案 / 次の一手. Compress a part only when it cannot bind the decision; never silently drop the backcast, the KPI definitions, or the closing section.",
    "- Funnel vocabulary is fixed: リーチ -> リード -> MQL -> SQL -> 商談 -> 受注. Show the backcast from the goal backwards: goal -> required orders -> meetings -> SQL -> MQL -> leads -> reach, with the conversion rate written next to the stage it produces.",
    "- Number discipline (hard rule): every number in the plan is user-supplied, computed from user-supplied numbers by arithmetic you show, or an assumption. An assumed rate, price, or volume must be visibly labelled 「仮置き（仮定）」 at the point of use, with a note that it will be calibrated once actual results exist. Never fill a missing figure with a plausible-looking number presented as fact, and never raise a rate to make the plan appear to reach the goal — if the numbers do not close the gap, say plainly that they do not close it and show the size of the remaining gap.",
    "- KPIs come in three classes — result （結果）, process （過程）, efficiency （効率） — and a vanity metric (raw PV, follower counts, impressions alone) is never the primary KPI. Fix the measurement definitions (what counts as an MQL/SQL, the period, the source of the count) inside the plan, not later.",
    "- Beyond-the-request actions, within the plan only: (1) fill missing premises as explicit assumptions — ask at most one short question, and only when the answer would materially change the plan; otherwise proceed with a one-line stated premise. (2) Design to the higher purpose behind the request, but do not add deliverable types the user did not ask for. (3) Close with the separate final section （次の一手 / リスク / 代替案）: next actions named as who does what, by when, and how many; risks as the condition that breaks a premise and its impact; alternatives as the switch if a premise breaks, with sensitivity where you can give it. (4) If the conversation or the provided context contains relevant past plans or data, propose combining them — as a proposal only; never write as if past data exists when none was provided.",
    "- Keep the added sections smaller than the body of the plan. The plan itself, at decision-ready specificity, is the deliverable.",
    ...formatBackcastBlock(profile),
  ].join("\n");
}
