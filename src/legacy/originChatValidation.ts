import type { OriginExecutionPolicy } from "../lib/orchestration/OriginExecutionPolicy";
import {
  detectSensitiveInput,
  type SensitiveInputKind,
} from "../lib/orchestration/SensitiveInputDetector";
import type { OriginChatMessage } from "./originProviderClient";

export interface OriginChatBody {
  messages?: unknown;
  userLocation?: unknown;
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

  return Array.from(kinds);
}

export function originClientPolicy(body: OriginChatBody): Partial<OriginExecutionPolicy> | undefined {
  const input = body.executionPolicy;
  if (!input) return undefined;

  const policy: Partial<OriginExecutionPolicy> = {};
  if (typeof input.maxEstimatedCostUsd === "number") policy.maxEstimatedCostUsd = input.maxEstimatedCostUsd;
  if (typeof input.timeoutMs === "number") policy.timeoutMs = input.timeoutMs;
  return policy;
}

export function isOriginWeatherRequest(message: string): boolean {
  return /(天気(は|って|どう|教えて|知りたい|予報|.*の天気)|傘(は必要|いる)|雨(降る|？)|weather)/i.test(message)
    && !/(アプリ|API|設計|作る|方法|how to|build|create|気分)/i.test(message);
}

export function hasOriginWeatherLocation(message: string, userLocation: unknown): boolean {
  return message.includes("東京")
    || message.includes("大阪")
    || message.includes("札幌")
    || message.includes("福岡")
    || /[市区町村都道府県]/.test(message)
    || /\bin\b/i.test(message)
    || /\bat\b/i.test(message)
    || (typeof userLocation === "string" && userLocation.trim() !== "");
}
