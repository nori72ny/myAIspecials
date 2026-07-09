import { GoogleGenAI } from "@google/genai";

export async function callLLM(options: {
  prompt: string;
  systemInstruction?: string;
  jsonMode?: boolean;
  model?: string;
  messages?: Array<{ role: string; content: string }>;
}): Promise<string> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (openrouterKey) {
    // OpenRouter integration
    const model = options.model || "google/gemini-2.5-flash";
    const endpoint = "https://openrouter.ai/api/v1/chat/completions";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openrouterKey}`,
      "HTTP-Referer": "https://ai.studio/build",
      "X-Title": "ACOS Supreme OS"
    };

    const messages = [];
    if (options.systemInstruction) {
      messages.push({ role: "system", content: options.systemInstruction });
    }
    
    if (options.messages && options.messages.length > 0) {
      // Map user/ai roles correctly to user/assistant for OpenAI/OpenRouter spec
      messages.push(...options.messages.map(m => ({
        role: m.role === "ai" || m.role === "assistant" || m.role === "model" ? "assistant" : "user",
        content: m.content
      })));
    } else {
      messages.push({ role: "user", content: options.prompt });
    }

    const body: any = {
      model,
      messages,
      temperature: 0.1
    };

    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenRouter returned status ${res.status}: ${text}`);
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    } catch (err) {
      console.error("OpenRouter API error:", err);
      // Fallback to Gemini if key is present
      if (geminiKey) {
        console.log("OpenRouter failed, falling back to direct Gemini...");
      } else {
        throw err;
      }
    }
  }

  // Direct Gemini API
  if (!geminiKey) {
    throw new Error("Neither OPENROUTER_API_KEY nor GEMINI_API_KEY is configured. Please set them in AI Studio Settings.");
  }

  const ai = new GoogleGenAI({
    apiKey: geminiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } }
  });

  const model = options.model || "gemini-2.5-flash";
  
  let contents: any = options.prompt;
  if (options.messages && options.messages.length > 0) {
    contents = options.messages.map(m => ({
      role: m.role === "ai" || m.role === "assistant" || m.role === "model" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
  }

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: options.systemInstruction,
      responseMimeType: options.jsonMode ? "application/json" : "text/plain",
      temperature: 0.1
    }
  });

  return response.text || "";
}
