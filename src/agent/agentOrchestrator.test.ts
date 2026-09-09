import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAgentOrchestratorRouter } from './agentOrchestrator';

describe('agent orchestrator run contract', () => {
  it('streams one bounded run with monotonic events and an awaiting-approval terminal frame', async () => {
    const app = express();
    app.use(express.json());
    app.use(createAgentOrchestratorRouter());
    const response = await request(app).post('/api/agent').send({ goal: '安全な計画を作成してください' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-origin-agent-run-id']).toMatch(/^run-/);
    expect(response.text).toMatch(/data: \[DONE\]\s*$/);

    const events = response.text.split('\n')
      .filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice(6)) as { runId: string; sequence: number; status: string; type: string; costUsd: number; paidFallbackUsed: boolean });
    expect(events.length).toBeGreaterThan(5);
    expect(new Set(events.map((event) => event.runId))).toEqual(new Set([response.headers['x-origin-agent-run-id']]));
    expect(events.map((event) => event.sequence)).toEqual(events.map((_event, index) => index + 1));
    expect(events.every((event) => event.costUsd === 0 && event.paidFallbackUsed === false)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'awaiting_approval' });
    expect(events.some((event) => event.status === 'completed')).toBe(false);
  });

  it('keeps execution fail-closed without authenticated one-time approval', async () => {
    const app = express();
    app.use(express.json());
    app.use(createAgentOrchestratorRouter());
    const response = await request(app).post('/api/agent').send({ action: 'execute', toolName: 'document_generator', params: { content: 'test' } });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ ok: false, code: 'AGENT_AUTHENTICATED_APPROVAL_REQUIRED' });
  });
});
