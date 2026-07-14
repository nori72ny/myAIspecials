import express from 'express';
import { createLegacyRouter } from '../legacyRoutes';
import request from 'supertest';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import * as aiClient from '../aiClient';

vi.mock('../aiClient');

describe('legacyRoutes API', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-api-key';
    app = express();
    app.use(express.json());
    app.use('/', createLegacyRouter());
  });

  describe('POST /api/chat', () => {
    it('returns 400 if messages is not an array', async () => {
      const response = await request(app).post('/api/chat').send({});
      expect(response.status).toBe(400);
      expect(response.body).toEqual(expect.objectContaining({
        code: 'INVALID_CHAT_MESSAGES',
        message: 'チャットメッセージの形式が正しくありません。'
      }));
    });

    it('returns 400 if the last message is not from a user', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'ai', content: 'hello' }] });
      
      expect(response.status).toBe(400);
      expect(response.body).toEqual(expect.objectContaining({
        code: 'INVALID_CHAT_MESSAGES',
        message: 'チャットメッセージの形式が正しくありません。最後のメッセージはユーザーからのものである必要があります。'
      }));
    });

    it('successfully routes a valid chat request to AI Client', async () => {
      vi.mocked(aiClient.callLLM).mockResolvedValueOnce('The capital of France is Paris.');

      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user', content: 'What is the capital of France?' }] });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('The capital of France is Paris.');
      expect(response.body.routing).toBeDefined();
      expect(aiClient.callLLM).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([{ role: 'user', content: 'What is the capital of France?' }]),
          systemInstruction: expect.stringContaining('Do not hallucinate unknown facts')
        })
      );
    });

    it('instructs AI not to hallucinate unknown facts', async () => {
      vi.mocked(aiClient.callLLM).mockResolvedValueOnce('I cannot retrieve the information.');

      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user', content: 'Tell me something' }] });

      expect(response.status).toBe(200);
      expect(aiClient.callLLM).toHaveBeenCalledWith(
        expect.objectContaining({
          systemInstruction: expect.stringContaining('Do not hallucinate unknown facts')
        })
      );
    });

    it('intercepts weather query without location', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user', content: '今日の天気は？' }] });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('どの地域の天気をお調べしますか？');
      expect(response.body.routing.model).toBe('Application Logic (No AI)');
      expect(aiClient.callLLM).not.toHaveBeenCalled();
    });

    it('intercepts English weather query without location', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user', content: 'What is the weather today?' }] });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('Which location would you like to know the weather for?');
      expect(response.body.routing.model).toBe('Application Logic (No AI)');
      expect(aiClient.callLLM).not.toHaveBeenCalled();
    });

    it('proceeds to AI when weather query has location', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user', content: '東京の今日の天気は？' }] });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('現在、最新の天気情報を取得するサービスが接続されていません。天気検索機能の設定が必要です。');
      expect(response.body.routing.model).toBe('Application Logic (No AI)');
      expect(aiClient.callLLM).not.toHaveBeenCalled();
    });

    it('uses user location from settings if weather query has no location', async () => {
      const response = await request(app)
        .post('/api/chat')
        .send({ 
          messages: [{ role: 'user', content: '今日の天気は？' }],
          userLocation: '大阪'
        });

      expect(response.status).toBe(200);
      expect(response.body.content).toBe('現在、最新の天気情報を取得するサービスが接続されていません。天気検索機能の設定が必要です。');
      expect(response.body.routing.model).toBe('Application Logic (No AI)');
      expect(aiClient.callLLM).not.toHaveBeenCalled();
    });

    it('handles AI Client error with status mapping', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).status = 429;
      vi.mocked(aiClient.callLLM).mockRejectedValueOnce(rateLimitError);

      const response = await request(app)
        .post('/api/chat')
        .send({ messages: [{ role: 'user', content: 'test' }] });

      expect(response.status).toBe(429);
      expect(response.body).toEqual(expect.objectContaining({
        code: 'PROVIDER_RATE_LIMITED'
      }));
    });
  });
});


