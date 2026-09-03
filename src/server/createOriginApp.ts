import express, { type ErrorRequestHandler, type Express } from "express";
import { originChatBoundaryGuard } from "../legacy/originChatBoundaryGuard.js";
import { createOriginChatRouter } from "../legacy/originChatRouter.js";
import { createOriginResearchRouter } from "../legacy/originResearchRouter.js";
import { createOriginLegacyProviderBoundaryRouter } from "../legacy/originLegacyProviderBoundaryGuard.js";
import { applyOriginSecurityHeaders, createOriginChatRateLimiter, requireSafeOriginChatRequest } from "./originSecurity.js";
import { detectImageStyle, enhanceImagePrompt, type ImageStyle } from "../services/imagePromptEngine.js";
import { createAgentOrchestratorRouter } from "../agent/agentOrchestrator.js";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const IMAGE_STYLES: readonly ImageStyle[] = ["photorealistic", "manga", "cel_anime", "stylized_3d", "fine_art", "ghibli", "disney", "scenery"];
function isImageStyle(value: unknown): value is ImageStyle { return typeof value === "string" && IMAGE_STYLES.includes(value as ImageStyle); }
function looksLikeImageGenerationRequest(value: unknown): boolean { if (typeof value !== "string") return false; return /(?:generate|create|make|render|draw|image|photo|photograph|picture|画像|写真|描いて|生成)/i.test(value); }
export function resolveOriginReleaseSha(env: NodeJS.ProcessEnv = process.env): string { const candidate = env.VERCEL_GIT_COMMIT_SHA ?? env.ORIGIN_RELEASE_SHA; return candidate && FULL_GIT_SHA.test(candidate) ? candidate.toLowerCase() : "unknown"; }

export function createOriginApp(env: NodeJS.ProcessEnv = process.env): Express {
  const app = express();
  app.disable("x-powered-by");
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use(applyOriginSecurityHeaders(env));
  app.use("/api/chat", requireSafeOriginChatRequest(env), createOriginChatRateLimiter());
  app.use(express.json({ limit: "64kb", strict: true, type: ["application/json", "application/*+json"] }));

  const invalidJsonHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (error instanceof SyntaxError && "body" in error) { res.status(400).json({ code: "INVALID_JSON_BODY", message: "JSONリクエストの形式が正しくありません。", retryable: false, requestId: "UNKNOWN" }); return; }
    if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") { res.status(413).json({ code: "REQUEST_BODY_TOO_LARGE", message: "リクエストの容量が上限を超えています。", retryable: false, requestId: "UNKNOWN" }); return; }
    next(error);
  };
  app.use(invalidJsonHandler);

  app.post("/api/generate-image", (req, res) => {
    const prompt = req.body?.prompt;
    const requestedStyle = req.body?.style;
    if (typeof prompt !== "string" || prompt.trim().length === 0) return res.status(400).json({ code: "INVALID_IMAGE_PROMPT", message: "画像生成プロンプトを指定してください。", retryable: false });
    if (requestedStyle !== undefined && !isImageStyle(requestedStyle)) return res.status(400).json({ code: "INVALID_IMAGE_STYLE", message: "対応していない画像スタイルです。", styles: IMAGE_STYLES, retryable: false });
    const style = isImageStyle(requestedStyle) ? requestedStyle : detectImageStyle(prompt);
    const enhanced = enhanceImagePrompt(prompt, style);
    return res.status(200).json({ status: "ok", provider: "local-zero-cost", generated: false, prompt: enhanced.prompt, positivePrompt: enhanced.positivePrompt, negativePrompt: enhanced.negativePrompt, style: enhanced.style, styleDetected: requestedStyle === undefined, note: looksLikeImageGenerationRequest(prompt) ? "プロンプトを$0のローカル最適化のみ実施しました。外部画像生成APIは呼び出していません。" : "画像生成APIは呼び出さず、指定されたプロンプトのみ最適化しました。" });
  });

  app.use(createAgentOrchestratorRouter());
  app.use(createOriginLegacyProviderBoundaryRouter());
  app.get(["/health", "/api/health"], (_req, res) => res.status(200).json({ status: "ok", service: "acos-2", releaseSha: resolveOriginReleaseSha(env) }));
  // Research must run before the historical current-information fail-closed branch.
  app.use(createOriginResearchRouter());
  app.use(createOriginChatRouter({ env }));
  app.all("/api/chat", originChatBoundaryGuard);
  app.all(["/api", "/api/{*splat}"], (_req, res) => res.status(404).json({ code: "ORIGIN_API_ROUTE_NOT_FOUND", message: "指定されたAPIは利用できません。", retryable: false, requestId: "UNKNOWN" }));
  return app;
}
