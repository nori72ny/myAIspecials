export interface ChatMessagePayload {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AiServiceOptions {
  model?: string;
  apiKey?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

export interface AiServiceResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Directly sends a request to openrouter/free without preflight gatekeeping or over-guard blocking.
 * Automatically retries up to maxRetries times (default 2, total 3 attempts) on 429 rate limit responses.
 */
export async function sendOpenRouterChatRequest(
  messages: ChatMessagePayload[],
  options: AiServiceOptions = {}
): Promise<AiServiceResponse> {
  const model = options.model || 'openrouter/free';
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 50;
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
          'HTTP-Referer': 'https://origin.ai',
          'X-Title': 'ORIGIN Personal',
        },
        signal: options.signal,
        body: JSON.stringify({
          model,
          messages,
        }),
      });

      if (response.status === 429) {
        if (attempt < maxRetries) {
          attempt++;
          if (retryDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
          continue;
        }
        throw new Error('HTTP 429: Rate limit exceeded after maximum automatic retries.');
      }

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      return {
        content,
        model: data.model || model,
        usage: data.usage,
      };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw error;
      }
      if (attempt < maxRetries && (error as Error).message.includes('429')) {
        attempt++;
        if (retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
        continue;
      }
      throw error;
    }
  }

  throw new Error('Failed to complete request to OpenRouter.');
}
