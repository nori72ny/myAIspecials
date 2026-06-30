export const fetchOpenAI = async (prompt: string): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI APIキー（OPENAI_API_KEY）が設定されていません。AI StudioのSettings（またはSecrets）パネルから鍵を設定してください。プレビュー環境では、鍵を設定するまでこの機能はご利用いただけません。");
  }

  const isOpenRouter = apiKey.trim().startsWith("sk-or-");
  const endpoint = isOpenRouter 
    ? "https://openrouter.ai/api/v1/chat/completions" 
    : "https://api.openai.com/v1/chat/completions";
  
  const model = isOpenRouter ? "openai/gpt-4o" : "gpt-4o";

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    };

    if (isOpenRouter) {
      headers["HTTP-Referer"] = "https://ai.studio/build";
      headers["X-Title"] = "Dual AI Consensus Analyzer";
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: `ユーザーの質問に対して、知識ベースから日本語で正確かつ極めて簡潔（目安として300〜400文字程度）に回答してください。挨拶は一切不要です。「最新」「リアルタイム」等の断定表現は避け、客観的な事実に基づき回答してください。\n\n質問: ${prompt}`
          }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API returned status ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (error: any) {
    console.error("fetchOpenAI error:", error);
    throw error;
  }
};
