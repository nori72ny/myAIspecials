import type { OriginExecutionPolicy } from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  canonicalizeSensitiveInput,
  detectSensitiveInput,
  findSensitiveInputSpans,
  type SensitiveInputKind,
  type SensitiveInputSpan,
} from "../lib/orchestration/SensitiveInputDetector.js";
import type { OriginChatMessage } from "./originProviderClient.js";
import { enterActiveContext } from "../lib/orchestration/activeContextRequestStore.js";

export interface OriginChatBody {
  messages?: unknown;
  userLocation?: unknown;
  activeContext?: unknown;
  executionPolicy?: { maxEstimatedCostUsd?: unknown; timeoutMs?: unknown };
  /**
   * Explicit client marker (P1 countermeasure 2): this send is a
   * transformation of the previous answer (an answer-refinement
   * pill), not a new user-authored request. It is judged only through
   * isRefinementOfPreviousAnswer — never by scanning the send's text.
   */
  refinementOfPreviousAnswer?: unknown;
}

export function validateOriginChatMessages(value: unknown): OriginChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const messages: OriginChatMessage[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if (role !== "user" && role !== "ai" && role !== "assistant" && role !== "model") return null;
    if (typeof content !== "string" || content.trim() === "") return null;
    messages.push({ role, content });
  }
  return messages;
}

/**
 * Whether this request carries the refinement marker AND the marker
 * matches the conversation shape it asserts: the final message is the
 * user's, and the immediately preceding message is an assistant answer
 * — the answer the send transforms. A marker without a previous
 * answer is ignored, so a stray or forged marker never changes routing
 * on its own and the send is treated exactly like an ordinary one.
 * Marked sends are excluded from the text-scan route classification
 * (research-request patterns and the like): a refinement instruction
 * is machine-generated prose that can coincidentally match those
 * patterns, which is exactly how the P1 misrouting happened.
 */
export function isRefinementOfPreviousAnswer(body: OriginChatBody, messages: OriginChatMessage[]): boolean {
  if (body.refinementOfPreviousAnswer !== true) return false;
  if (messages.length < 2) return false;
  if (messages[messages.length - 1].role !== "user") return false;
  return messages[messages.length - 2].role !== "user";
}

export function detectSensitiveConversation(messages: OriginChatMessage[]): SensitiveInputKind[] {
  const kinds = new Set<SensitiveInputKind>();
  for (const message of messages) {
    const detection = detectSensitiveInput(message.content);
    for (const kind of detection.kinds) {
      const isUserMessage = message.role === "user";
      const isStructuredSecret = kind !== "credential-term";
      if (isUserMessage || isStructuredSecret) kinds.add(kind);
    }
  }
  const structuredStreams = [messages.map((message) => message.content).join(""), messages.filter((message) => message.role === "user").map((message) => message.content).join(""), messages.filter((message) => message.role !== "user").map((message) => message.content).join("")];
  for (const stream of structuredStreams) {
    const detection = detectSensitiveInput(stream);
    for (const kind of detection.kinds) if (kind !== "credential-term") kinds.add(kind);
  }
  return Array.from(kinds);
}

/** Fixed, content-free replacement for a redacted sensitive span. */
export const SENSITIVE_INPUT_REDACTION_TOKEN = "[redacted]";

export interface OriginConversationScreenResult {
  outcome: "clean" | "sanitized" | "blocked";
  /**
   * Kinds to report when the outcome is "blocked". Identical to
   * detectSensitiveConversation over the original messages, so a blocked
   * response is unchanged from the pre-S-1 behavior.
   */
  sensitiveKinds: SensitiveInputKind[];
  /**
   * The single outbound copy every downstream consumer must use. For
   * "clean" and "blocked" this is the input array itself; for
   * "sanitized" it is a copy whose assistant-turn sensitive spans were
   * replaced on their canonicalized form. The caller's stored/displayed
   * conversation is never modified.
   */
  messages: OriginChatMessage[];
  /** Kinds redacted from assistant turns (populated only for "sanitized"). */
  redactedKinds: SensitiveInputKind[];
  /** Number of replaced segments (populated only for "sanitized"). */
  redactionCount: number;
}

function redactSensitiveSpans(canonicalContent: string, spans: readonly SensitiveInputSpan[]): { text: string; count: number } {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      if (span.end > last.end) last.end = span.end;
    } else {
      merged.push({ start: span.start, end: span.end });
    }
  }
  let text = "";
  let cursor = 0;
  for (const segment of merged) {
    text += canonicalContent.slice(cursor, segment.start) + SENSITIVE_INPUT_REDACTION_TOKEN;
    cursor = segment.end;
  }
  text += canonicalContent.slice(cursor);
  return { text, count: merged.length };
}

/**
 * S-1b (INTENT_I5_DESIGN_2026-11-22 §5; security review 2026-11-22 §3):
 * the structured conversation screen shared by the chat, streaming, and
 * research routers so every send path applies one policy.
 *
 * - "blocked": a hit is attributable to a user turn, or cannot be fully
 *   explained by spans inside individual assistant messages (split hits
 *   across messages — above all across a user/assistant boundary — are
 *   never redacted). The caller answers 422 exactly as before.
 * - "sanitized": every hit came from assistant turns and each was fully
 *   replaced on the canonicalized send copy; the copy was then
 *   re-screened end to end and came back clean. If re-screening still
 *   detects anything, the outcome is "blocked" instead (fail closed).
 * - "clean": nothing detected; the input is used as-is.
 *
 * credential-term keeps its existing treatment: it blocks in user turns
 * and is not a blocking kind in assistant turns, so it is never redacted.
 */
export function screenConversationForSend(messages: OriginChatMessage[]): OriginConversationScreenResult {
  const baselineKinds = detectSensitiveConversation(messages);
  if (baselineKinds.length === 0) {
    return { outcome: "clean", sensitiveKinds: [], messages, redactedKinds: [], redactionCount: 0 };
  }
  const blocked: OriginConversationScreenResult = {
    outcome: "blocked",
    sensitiveKinds: baselineKinds,
    messages,
    redactedKinds: [],
    redactionCount: 0,
  };

  // Any hit inside a user turn blocks, unchanged from the pre-S-1 policy.
  for (const message of messages) {
    if (message.role === "user" && detectSensitiveInput(message.content).containsSensitiveInput) {
      return blocked;
    }
  }

  let redactionCount = 0;
  const redactedKinds = new Set<SensitiveInputKind>();
  const sendCopy = messages.map((message) => {
    if (message.role === "user") return message;
    const spans = findSensitiveInputSpans(message.content).filter((span) => span.kind !== "credential-term");
    if (spans.length === 0) return message;
    const redacted = redactSensitiveSpans(canonicalizeSensitiveInput(message.content), spans);
    redactionCount += redacted.count;
    for (const span of spans) redactedKinds.add(span.kind);
    return { role: message.role, content: redacted.text };
  });
  // No redactable span anywhere: the baseline hit is only visible to the
  // cross-message stream checks (a split secret), which redaction cannot
  // safely remove.
  if (redactionCount === 0) return blocked;

  // Fail-closed verification of the final outbound copy: split hits,
  // boundary artifacts of the replacement, or anything missed above keep
  // the 422 rather than letting a value leave.
  if (detectSensitiveConversation(sendCopy).length > 0) return blocked;

  return {
    outcome: "sanitized",
    sensitiveKinds: [],
    messages: sendCopy,
    redactedKinds: Array.from(redactedKinds),
    redactionCount,
  };
}

export function originClientPolicy(body: OriginChatBody): Partial<OriginExecutionPolicy> | undefined {
  enterActiveContext(body.activeContext);
  const input = body.executionPolicy;
  if (!input) return undefined;
  const policy: Partial<OriginExecutionPolicy> = {};
  if (typeof input.maxEstimatedCostUsd === "number") policy.maxEstimatedCostUsd = input.maxEstimatedCostUsd as 0;
  if (typeof input.timeoutMs === "number") policy.timeoutMs = input.timeoutMs;
  return policy;
}

export function isOriginWeatherRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  const hasWeatherSignal = message.includes("天気") || message.includes("傘は必要") || message.includes("傘いる") || message.includes("雨降る") || message.includes("雨？") || normalized.includes("weather");
  const hasExcludedIntent = message.includes("アプリ") || normalized.includes("api") || message.includes("設計") || message.includes("作る") || message.includes("方法") || normalized.includes("how to") || normalized.includes("build") || normalized.includes("create") || message.includes("気分");
  return hasWeatherSignal && !hasExcludedIntent;
}

export function hasOriginWeatherLocation(message: string, userLocation: unknown): boolean {
  const commonJapaneseLocation = /(?:東京|大阪|札幌|福岡|名古屋|横浜|京都|渋谷(?:区)?|新宿(?:区)?|品川(?:区)?|世田谷(?:区)?)/.test(message);
  const commonInternationalLocation = /\b(?:london|new york|los angeles|san francisco|seattle|boston|chicago|paris|berlin|seoul|singapore|sydney|toronto|vancouver|melbourne|bangkok|taipei|hong kong)\b/i.test(message);
  return commonJapaneseLocation || commonInternationalLocation || (typeof userLocation === "string" && userLocation.trim().length > 0);
}
