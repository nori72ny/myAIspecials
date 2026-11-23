import type { OriginResearchSource } from "../legacy/originResearchSource.js";
import {
  applyOriginPublicationGate,
  publicationGateFiringKinds,
  type OriginPublicationClaimKind,
} from "../lib/orchestration/OriginPublicationGate.js";
import {
  GROUNDED_RESEARCH_FACT_SLOT_ENTRIES,
  matchGroundedResearchFactSlotEntry,
} from "./groundedResearchFactSlotsV13.js";
import {
  buildGroundedResearchRecordsPacket,
  evaluateGroundedResearchFactSlotStatedValues,
  renderGroundedResearchFactSlotSentence,
} from "./groundedResearchRecordsV13.js";

/**
 * P3-1 (WEEKLY_INSPECTION_P3_DESIGN_2026-11-23 §3 / §4): the
 * deterministic direct-answer layer at the tier-T3 landing.
 *
 * The weekly inspection's Q2 (the current Prime Minister question)
 * was classified, researched, and retrieved correctly — five
 * sources — and still landed on a sources-only card list, because
 * every deterministic rescue for the incumbent class is closed by
 * design or switched off: the recovery template excludes person
 * names on purpose, the fact-slot records path (which owns the
 * deterministic stated-answer extraction and the tier/agreement
 * judgement) is off in production and spends a generation to
 * propose its candidate, and quote-first is unregistered. When the
 * synthesis is not adopted, no shape exists that can carry an
 * answer the retrieved sources already state.
 *
 * This layer is that shape. It is pure and deterministic — no model
 * call, no Neurons — so it also works when the synthesis fell
 * because the provider was unavailable (failure type T-1):
 *
 *  - the question must match a registered fact-slot entry
 *    (groundedResearchFactSlotsV13; the fail-closed all-patterns +
 *    exclusion-veto match). No entry, no fire — the layer's reach
 *    is exactly the registered fact types;
 *  - the candidate is DERIVED from the kept sources' own stated
 *    answers by the records module's deterministic stated-value
 *    evaluation (evaluateGroundedResearchFactSlotStatedValues):
 *    every field's value must be stated as the answer by at least
 *    two independent sources, with no competing stated value and
 *    no tier opposition. Values come only from the freshness-kept
 *    pool the caller passes (the router's grounded sources) —
 *    dropped candidates are never re-judged here;
 *  - the rendering is the slot entry's own template sentence plus
 *    the verbatim supporting quotes and the agreement count (the
 *    R-PR-8b evidence block shape), so the answer arrives with its
 *    grounds attached.
 *
 * The switch is ORIGIN_RESEARCH_DIRECT_ANSWER_MODE ("off" default /
 * "shadow" / "enforce"). This PR implements the computation and the
 * shadow observation only: in shadow the caller logs the attempt
 * (logResearchDirectAnswerShadow) and delivers the original answer
 * byte-identically. Enforce delivery is a later stage (P3-3) and,
 * for classes whose template sentence trips the publication gate's
 * position-status shape (the incumbent class), additionally waits
 * on the verified-claim channel designed with the G-1 track
 * (§3.4): the gate is never bypassed and no wording is chosen to
 * evade it. The gate judgement computed here — the rendered core
 * run through applyOriginPublicationGate, recorded as held /
 * firing kinds — is the shadow material that stage is measured
 * against.
 */

export type ResearchDirectAnswerMode = "off" | "shadow" | "enforce";

/**
 * Selected by ORIGIN_RESEARCH_DIRECT_ANSWER_MODE. Only the exact
 * values "shadow" and "enforce" enable the layer; everything else —
 * including an unset variable — is off, so production behavior is
 * unchanged until the mode is deliberately registered (Stage 1
 * common rule: switches default OFF / shadow first).
 */
export function resolveResearchDirectAnswerMode(
  env: NodeJS.ProcessEnv | undefined,
): ResearchDirectAnswerMode {
  if (env?.ORIGIN_RESEARCH_DIRECT_ANSWER_MODE === "shadow") return "shadow";
  if (env?.ORIGIN_RESEARCH_DIRECT_ANSWER_MODE === "enforce") return "enforce";
  return "off";
}

export interface ResearchDirectAnswerFieldOutcome {
  fieldId: string;
  /** The adopted value's verbatim surface form; null when the field did not adopt. */
  value: string | null;
  /** Distinct packet sources stating the adopted value as their answer. */
  statedSupportSourceIds: string[];
  /** A known-tier source states a different value and outranks the value's stated support. */
  tierOpposed: boolean;
  /** A packet source states a different value for this field as its answer. */
  conflictDetected: boolean;
}

export interface ResearchDirectAnswerAttempt {
  mode: ResearchDirectAnswerMode;
  /** The matched fact-slot entry id; null when the question matched none. */
  entryId: string | null;
  /** Whether the layer would state the answer directly (in shadow: would-fire). */
  fired: boolean;
  /**
   * Why the layer did not fire: "mode-off", "no-slot-entry",
   * "insufficient-sources", a slot failure code
   * (SLOT_NO_CANDIDATE / SLOT_INSUFFICIENT_AGREEMENT /
   * SLOT_SOURCE_CONFLICT / SLOT_ANSWER_SHAPE_MISMATCH /
   * SLOT_QUOTE_REQUIREMENT_UNMET / SLOT_RENDER_CHECK_FAILED).
   * Null exactly when fired.
   */
  reason: string | null;
  /** Distinct kept sources whose excerpt contains the whole field set verbatim. */
  agreementSourceCount: number;
  /** Source ids (packet numbering) of the agreeing sources. */
  supportSourceIds: string[];
  /** Per-field judgement detail, in entry order. */
  fields: ResearchDirectAnswerFieldOutcome[];
  /**
   * The rendered direct-answer core — the template sentence plus
   * the verbatim-quote evidence block — present exactly when fired.
   * At enforce time the caller delivers this ahead of the usual
   * tier-T3 source cards; in shadow it is computed and discarded.
   */
  text: string | null;
  /**
   * Whether the publication gate holds the rendered core under its
   * current rules, and the evidence-required kinds that fired.
   * Computed whenever the layer fired; null otherwise. For the
   * incumbent class this is expected to be held (position-status)
   * until the verified-claim channel lands (§3.4) — that is the
   * observation P3-1 exists to record, not an error.
   */
  gateHeld: boolean | null;
  gateFiringKinds: readonly OriginPublicationClaimKind[];
}

/** Field shapes whose adopted value is a name; recorded as status and counts only in logs. */
const NAME_FIELD_SHAPES: ReadonlySet<string> = new Set(["person-name", "vaccine-name"]);

/**
 * Runs the direct-answer layer over the kept sources of one
 * research request. Pure and total: any failure is a reason on the
 * returned attempt, never a throw, and the inputs are not mutated.
 * Mode "off" short-circuits before any extraction.
 */
export function tryResearchDirectAnswer(input: {
  question: string;
  sources: readonly OriginResearchSource[];
  language: "ja" | "en";
  mode?: ResearchDirectAnswerMode;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  requestId?: string;
}): ResearchDirectAnswerAttempt {
  const mode = input.mode ?? resolveResearchDirectAnswerMode(input.env);
  const base: ResearchDirectAnswerAttempt = {
    mode,
    entryId: null,
    fired: false,
    reason: null,
    agreementSourceCount: 0,
    supportSourceIds: [],
    fields: [],
    text: null,
    gateHeld: null,
    gateFiringKinds: [],
  };
  if (mode === "off") return { ...base, reason: "mode-off" };
  const entry = matchGroundedResearchFactSlotEntry(input.question);
  if (entry === null) return { ...base, reason: "no-slot-entry" };
  base.entryId = entry.id;
  // Stated agreement needs at least two independent sources; the
  // records packet (the single source of truth the stated-value
  // evaluation reads) is also where dropped or unsafe sources are
  // excluded, so a thin packet ends the attempt here.
  const packet = buildGroundedResearchRecordsPacket(input.sources);
  if (packet.sources.length < 2) return { ...base, reason: "insufficient-sources" };
  const evaluation = evaluateGroundedResearchFactSlotStatedValues(entry, packet);
  const fields: ResearchDirectAnswerFieldOutcome[] = evaluation.fields.map((field) => ({
    fieldId: field.fieldId,
    value: field.value,
    statedSupportSourceIds: field.statedSupportSourceIds,
    tierOpposed: field.tierOpposed,
    conflictDetected: field.conflictDetected,
  }));
  if (evaluation.code !== null || evaluation.candidate === null || evaluation.source === null) {
    return {
      ...base,
      reason: evaluation.code ?? "SLOT_NO_CANDIDATE",
      agreementSourceCount: evaluation.agreementSourceCount,
      supportSourceIds: evaluation.supportSourceIds,
      fields,
    };
  }
  const sentence = renderGroundedResearchFactSlotSentence(
    entry,
    evaluation.candidate,
    evaluation.source,
    input.language,
  );
  if (sentence === null) {
    return {
      ...base,
      reason: "SLOT_RENDER_CHECK_FAILED",
      agreementSourceCount: evaluation.agreementSourceCount,
      supportSourceIds: evaluation.supportSourceIds,
      fields,
    };
  }
  // The evidence block (R-PR-8b shape): one verbatim-quote line per
  // field with its source citation, then the agreement count. The
  // caller appends the usual source cards at enforce time; the
  // quotes here are the field quotes the evaluation verified.
  const sourceById = new Map(packet.sources.map((packetSource) => [packetSource.id, packetSource]));
  const headlineSource = evaluation.source;
  const evidenceLines = entry.fields.map((field) => {
    const fieldCandidate = evaluation.candidate!.fields[field.id]!;
    const fieldSource = sourceById.get(fieldCandidate.src) ?? headlineSource;
    const citation = `[${fieldSource.id}](${fieldSource.url})`;
    const quote = fieldCandidate.quote.replace(/\s+/g, " ").trim();
    if (entry.fields.length === 1) {
      return input.language === "ja"
        ? `根拠の引用文：「${quote}」 ${citation}`
        : `Supporting quote: "${quote}" ${citation}`;
    }
    return input.language === "ja"
      ? `根拠の引用文（${field.label.ja}）：「${quote}」 ${citation}`
      : `Supporting quote (${field.label.en}): "${quote}" ${citation}`;
  });
  if (evaluation.agreementSourceCount >= 2) {
    const citation = `[${headlineSource.id}](${headlineSource.url})`;
    evidenceLines.push(
      input.language === "ja"
        ? `この答えは、${evaluation.agreementSourceCount}件の出典で一致しています。 ${citation}`
        : `This answer is consistent across ${evaluation.agreementSourceCount} sources. ${citation}`,
    );
  }
  const headline = `${sentence} [${headlineSource.id}](${headlineSource.url})`;
  const text = `${headline}\n\n${evidenceLines.join("\n")}`;
  // The gate judgement (see the module note): the rendered core is
  // run through the publication gate exactly as a delivery would
  // be, with the gate's own logging silenced — the judgement is
  // recorded on this attempt and in the layer's shadow log instead.
  // The detector's firing kinds are read off the summary so the
  // recorded judgement does not depend on the gate's own mode.
  const gate = applyOriginPublicationGate({
    requestId: input.requestId ?? "research-direct-answer",
    answerText: text,
    query: input.question,
    language: input.language,
    env: input.env,
    nowMs: input.nowMs,
    logger: () => {},
  });
  const gateFiringKinds: readonly OriginPublicationClaimKind[] =
    gate.firingKinds.length > 0
      ? gate.firingKinds
      : gate.summary !== null
        ? publicationGateFiringKinds(gate.summary)
        : [];
  return {
    ...base,
    fired: true,
    agreementSourceCount: evaluation.agreementSourceCount,
    supportSourceIds: evaluation.supportSourceIds,
    fields,
    text,
    gateHeld: gate.held || gateFiringKinds.length > 0,
    gateFiringKinds,
  };
}

/**
 * Shadow-mode log for the direct-answer layer, in the house
 * discipline of the other research shadow logs (the recovery value
 * vote, the recovery template): flat scalar fields, counts and
 * codes — never the question, the quotes, titles, or URLs. An
 * adopted value is recorded only for non-name field shapes (a
 * number, an amount, a date-like timing — the "numbers and codes"
 * discipline); person and vaccine names are recorded as status and
 * counts only. Never throws and never touches the answer.
 */
export function logResearchDirectAnswerShadow(input: {
  requestId: string;
  attempt: ResearchDirectAnswerAttempt;
  logger?: (message: string, fields: Record<string, unknown>) => void;
}): void {
  const logger = input.logger ?? ((message, fields) => console.info(message, fields));
  try {
    const attempt = input.attempt;
    const entry = attempt.entryId;
    const loggedValues: Record<string, string> = {};
    if (attempt.fired && entry !== null) {
      // Name-shaped values stay out of the log (status and counts
      // only); the shapes are read off the registered entry.
      const entryDefinition = GROUNDED_RESEARCH_FACT_SLOT_ENTRIES.find(
        (candidate) => candidate.id === entry,
      );
      const shapeByFieldId = new Map(
        (entryDefinition?.fields ?? []).map((field) => [field.id, field.shape]),
      );
      for (const field of attempt.fields) {
        if (field.value === null) continue;
        const shape = shapeByFieldId.get(field.fieldId);
        if (shape !== undefined && NAME_FIELD_SHAPES.has(shape)) continue;
        loggedValues[field.fieldId] = field.value.slice(0, 40);
      }
    }
    logger("[origin-chat] research direct answer (shadow)", {
      requestId: input.requestId,
      directAnswerMode: attempt.mode,
      ...(entry !== null ? { directAnswerEntry: entry } : {}),
      directAnswerFired: attempt.fired,
      ...(attempt.reason !== null ? { directAnswerReason: attempt.reason } : {}),
      directAnswerAgreementSources: attempt.agreementSourceCount,
      ...(attempt.supportSourceIds.length > 0
        ? { directAnswerSupportSources: [...attempt.supportSourceIds] }
        : {}),
      directAnswerFields: attempt.fields.map((field) => ({
        field: field.fieldId,
        statedSupport: field.statedSupportSourceIds.length,
        tierOpposed: field.tierOpposed,
        conflict: field.conflictDetected,
      })),
      ...(attempt.gateHeld !== null ? { directAnswerGateHeld: attempt.gateHeld } : {}),
      ...(attempt.gateFiringKinds.length > 0
        ? { directAnswerGateFiringKinds: [...attempt.gateFiringKinds] }
        : {}),
      ...(Object.keys(loggedValues).length > 0 ? { directAnswerValues: loggedValues } : {}),
    });
  } catch (error) {
    try {
      logger("[origin-chat] research direct answer (shadow) failed", {
        requestId: input.requestId,
        directAnswerError: error instanceof Error ? error.name : "UnknownError",
      });
    } catch {
      // The shadow log never breaks the answer it observes.
    }
  }
}
