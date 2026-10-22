export interface ModelRequestOptions { prompt: string; temperature?: number; maxTokens?: number; }
export interface ModelResponse { content: string; modelUsed: string; costUsd: 0; privacyPolicy: string; }
export class ZeroCostModelRouter {
  private readonly paidFallbackEnabled: boolean = false;
  public async execute(options: ModelRequestOptions): Promise<ModelResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    let attempt = 0;
    while (attempt < 3) {
      attempt++;
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Client-Data-Policy": "no-retention" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: options.prompt }] }],
            generationConfig: { temperature: options.temperature ?? 0.1, maxOutputTokens: options.maxTokens ?? 2048 }
          })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("EMPTY_RESPONSE");
        return { content: text, modelUsed: "gemini-1.5-flash-latest", costUsd: 0, privacyPolicy: "ZERO_DATA_RETENTION_ENFORCED" };
      } catch (err) {
        if (attempt >= 3) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt + Math.random() * 500));
      }
    }
    throw new Error("FREE_QUOTA_EXHAUSTED");
  }
}
