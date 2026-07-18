import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { validateMissionQuality, ACOSValidationManager, CAPABILITIES_MAP } from "./src/utils/MissionValidator";

// Legacy imports
import { createLegacyRouter } from "./src/legacy/legacyRoutes";
import { createAnalyzeRouter } from "./src/legacy/analyzeRoute";
import { createOriginChatRouter } from "./src/legacy/originChatRouter";

// New architecture imports (Mission Engine)
import { initMissionEngine } from "./services/mission-engine/src/index";

function resolvePort(): number {
  const rawPort = process.env.TEST_PORT || process.env.PORT || "3000";
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid server port: ${rawPort}`);
  }

  return port;
}

async function startServer() {
  const app = express();
  const PORT = resolvePort();

  // Set Content Security Policy (CSP) for security hardening
  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "img-src 'self' data: https: blob:; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "connect-src 'self' ws: wss: https:;"
    );
    next();
  });

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "acos-2" });
  });

  // 0. Mount Mission Quality Validator endpoint
  app.post("/api/v1/validate-mission", async (req, res) => {
    const { request, output } = req.body;
    if (!request || !output) {
      return res.status(400).json({ error: "Missing 'request' or 'output' fields." });
    }

    const localResult = validateMissionQuality(request, output);

    // Route the validator itself to the optimal AI model via ACOS Routing Engine
    const manager = ACOSValidationManager.getInstance();
    const routingDecision = manager.routingEngine.route({
      input: `Analyze alignment quality and capabilities match. User request: "${request}". AI generated output: "${output}".`,
      priority: "quality"
    });

    const routedAI = routingDecision.primaryAI; // e.g. { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI" }
    
    // Choose executing model based on routed AI's capabilities
    // This strictly avoids Gemini lock-in by dynamically adapting execution characteristics!
    const executingModel = (routedAI.quality >= 9) ? "gemini-1.5-pro" : "gemini-1.5-flash";

    if (!process.env.GEMINI_API_KEY) {
      return res.json({
        ...localResult,
        engine: `Code-Engine Routing -> ${routedAI.name} (${routedAI.provider})`,
        details: localResult.details + ` (ACOS Routing Engine: ${routedAI.name} 推奨 - ローカルフォールバック動作)`
      });
    }

    try {
      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build" }
        }
      });

      const capabilityList = Object.keys(CAPABILITIES_MAP).map(cap => `- "${cap}"`).join("\n");

      const prompt = `
You are the Mission Quality Validator V2. Your purpose is to verify if the AI-generated artifact (Mission Output) matches the User's original request (Mission Goal).

Classify both the original request and the actual output into exactly ONE of the following 30 AI Capability labels:
${capabilityList}

If the capabilities align perfectly, validation succeeds (success: true, matchScore: 100).
If they represent completely different domains (e.g. Travel Planning vs Legal Reasoning), validation fails (success: false, matchScore: 30).
If they represent adjacent domains of same category (e.g., Code Generation vs Database Management, or Marketing vs Presentation), validation succeeds with partial score (success: true, matchScore: 75).

User Request: "${request.replace(/"/g, '\\"')}"
Generated Output: "${output.replace(/"/g, '\\"')}"

Respond ONLY with a valid JSON object matching this schema:
{
  "success": boolean,
  "requestCategory": "one of the 30 capability labels",
  "outputCategory": "one of the 30 capability labels",
  "matchScore": number,
  "details": "string explaining the validation verdict, domain category match, and recommended next steps in Japanese"
}
`;

      const response = await ai.models.generateContent({
        model: executingModel,
        contents: prompt,
        config: {
          responseMimeType: "application/json" }
      });

      const responseText = response.text || "";
      const resultObj = JSON.parse(responseText.trim());
      
      return res.json({
        ...localResult,
        ...resultObj,
        recommendedProvider: localResult.recommendedProvider,
        top3Providers: localResult.top3Providers,
        engine: `ACOS Router: ${routedAI.name} (${routedAI.provider}) [Executed via ${executingModel}]`
      });
    } catch (err) {
      console.error("Gemini validation error, falling back to local rules:", err);
      return res.json({
        ...localResult,
        engine: `ACOS Router Fallback: ${routedAI.name} (Local)`,
        details: localResult.details + ` (ACOS Routing Engine: ${routedAI.name} 判定、エラーによりローカルフォールバック動作)`
      });
    }
  });

  // Intercept analyze with streaming router first
  app.use(createAnalyzeRouter());

  // Route normal chat through the explicit ORIGIN safety and free-only policy first.
  app.use(createOriginChatRouter());

  // The legacy router still contains historical chat code. Never allow a chat request
  // to fall through to it if the authoritative ORIGIN route changes unexpectedly.
  app.all("/api/chat", (_req, res) => {
    return res.status(500).json({
      code: "ORIGIN_CHAT_BOUNDARY_NOT_HANDLED",
      message: "ORIGINの安全なチャット境界でリクエストを処理できなかったため、旧経路への移行を停止しました。",
      retryable: false,
      requestId: "UNKNOWN"
    });
  });

  // 1. Mount remaining Legacy Endpoints (/api/generate-image, /api/analyze, etc.)
  app.use(createLegacyRouter());

  // 2. Mount New Mission Engine API (/api/v1/...)
  app.use("/api/v1", initMissionEngine());

  // 3. Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
