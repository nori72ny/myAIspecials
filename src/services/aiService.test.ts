import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendOpenRouterChatRequest } from './aiService';

describe('aiService - sendOpenRouterChatRequest', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('directly sends requests to openrouter/free and returns content on 200 OK', async () => {
    const mockResponse = {
      model: 'openrouter/free',
      choices: [{ message: { content: 'Hello world from OpenRouter!' } }],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    const result = await sendOpenRouterChatRequest([{ role: 'user', content: 'Hi' }]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      })
    );
    expect(result.content).toBe('Hello world from OpenRouter!');
  });

  it('retries up to 2 times on HTTP 429 and succeeds if later attempt is 200 OK', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return { ok: false, status: 429, statusText: 'Too Many Requests' } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'openrouter/free',
          choices: [{ message: { content: 'Success on 3rd attempt' } }],
        }),
      } as Response;
    });

    const result = await sendOpenRouterChatRequest([{ role: 'user', content: 'Retry test' }], {
      retryDelayMs: 1,
    });

    expect(callCount).toBe(3);
    expect(result.content).toBe('Success on 3rd attempt');
  });

  it('throws an error after exceeding 2 retries (3 attempts) on 429', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    } as Response);

    await expect(
      sendOpenRouterChatRequest([{ role: 'user', content: 'Fail retries' }], { retryDelayMs: 1 })
    ).rejects.toThrow('HTTP 429');

    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});
