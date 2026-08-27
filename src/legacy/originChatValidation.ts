import type { OriginExecutionPolicy } from "../lib/orchestration/OriginExecutionPolicy.js";
import {
  detectSensitiveInput,
  type SensitiveInputKind,
} from "../lib/orchestration/SensitiveInputDetector.js";
import type { OriginChatMessage } from "./originProviderClient.js";

export interface OriginChatBody {
  messages?: unknown;
  userLocation?: unknown;
  activeContext?: unknown;
  executionPolicy?: {
    maxEstimatedCostUsd?: unknown;
    timeoutMs?: unknown;
  };
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

  const structuredStreams = [
    messages.map((message) => message.content).join(""),
    messages.filter((message) => message.role === "user").map((message) => message.content).join(""),
    messages.filter((message) => message.role !== "user").map((message) => message.content).join(""),
  ];
  for (const stream of structuredStreams) {
    const detection = detectSensitiveInput(stream);
    for (const kind of detection.kinds) {
      if (kind !== "credential-term") kinds.add(kind);
    }
  }

  return Array.from(kinds);
}

export function originClientPolicy(body: OriginChatBody): Partial<OriginExecutionPolicy> | undefined {
  const input = body.executionPolicy;
  if (!input) return undefined;

  const policy: Partial<OriginExecutionPolicy> = {};
  if (typeof input.maxEstimatedCostUsd === "number") policy.maxEstimatedCostUsd = input.maxEstimatedCostUsd as 0;
  if (typeof input.timeoutMs === "number") policy.timeoutMs = input.timeoutMs;
  return policy;
}

export function isOriginWeatherRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  const hasWeatherSignal = message.includes("天気")
    || message.includes("傘は必要")
    || message.includes("傘いる")
    || message.includes("雨降る")
    || message.includes("雨？")
    || normalized.includes("weather");
  const hasExcludedIntent = message.includes("アプリ")
    || normalized.includes("api")
    || message.includes("設計")
    || message.includes("作る")
    || message.includes("方法")
    || normalized.includes("how to")
    || normalized.includes("build")
    || normalized.includes("create")
    || message.includes("気分");

  return hasWeatherSignal && !hasExcludedIntent;
}

export function hasOriginWeatherLocation(message: string, userLocation: unknown): boolean {
  return message.includes("東京")
    || message.includes("大阪")
    || message.includes("札幌")
    || message.includes("福岡")
    || message.includes("名古屋")
    || message.includes("横浜")
    || message.includes("京都")
    || (typeof userLocation === "string" && userLocation.trim().length > 0);
}
