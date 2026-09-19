import type { OwnerImprovementCategory } from "../local/OwnerImprovementStore";

const explicitOriginTarget = /(?:ORIGIN|このアプリ|この画面|このUI|この回答|回答画面|アプリ画面)/i;
const improvementVerb = /(?:改善|直して|修正|追加して|入れて|見やすく|使いやすく|強化|変えて|変更|対応して|調べて.*導入|採用すべき|取り入れ)/i;

export function classifyOwnerImprovementCategory(text: string): OwnerImprovementCategory {
  const normalized = text.toLowerCase();
  if (/(security|privacy|prompt injection|secret|脆弱|漏洩|個人情報|セキュリティ|認証|権限)/i.test(text)) return "security";
  if (/(ui|ux|design|レイアウト|デザイン|見やす|使いやす|色|文字|画面)/i.test(text)) return "design";
  if (/(model|llm|ai|agent|claude|gemini|openai|copilot|モデル|エージェント|回答品質)/i.test(text)) return "ai";
  if (/(bug|error|fail|壊れ|不具合|落ち|動かない|保存|復元)/i.test(text)) return "reliability";
  if (/(performance|latency|speed|遅い|速度|軽量|高速)/i.test(text)) return "performance";
  if (/(service|api|github|vercel|supabase|cloudflare|外部サービス|連携)/i.test(text)) return "external";
  if (/(feature|機能|追加|新しく|改善)/i.test(text)) return "product";
  return normalized.length ? "other" : "other";
}

export function detectExplicitOwnerImprovementIntent(text: string): {
  matched: boolean;
  category: OwnerImprovementCategory;
} {
  const trimmed = text.trim();
  const matched = trimmed.length >= 4 && explicitOriginTarget.test(trimmed) && improvementVerb.test(trimmed);
  return { matched, category: classifyOwnerImprovementCategory(trimmed) };
}
