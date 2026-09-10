import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { generateArtifactV12 } from './artifactGeneratorV12.js';
import { createArtifactV12Router } from './artifactV12Router.js';

function app() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(createArtifactV12Router());
  return app;
}

describe('V1.2 real artifacts', () => {
  it('generates verified markdown, csv, pdf, docx and xlsx bytes', () => {
    const inputs = [
      { type: 'markdown' as const, title: 'Report', content: 'Hello' },
      { type: 'csv' as const, title: 'Data', rows: [['Name', 'Value'], ['A', 1]] },
      { type: 'pdf' as const, title: 'PDF', content: 'Portable document' },
      { type: 'docx' as const, title: 'DOCX', content: 'Word document' },
      { type: 'xlsx' as const, title: 'XLSX', rows: [['Metric', 'Value'], ['Sales', 42]] },
    ];
    for (const input of inputs) {
      const artifact = generateArtifactV12(input);
      expect(artifact.verified).toBe(true);
      expect(artifact.bytes.length).toBeGreaterThan(0);
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(generateArtifactV12(inputs[0]).bytes.toString('utf8')).toContain('# Report');
    expect(generateArtifactV12(inputs[1]).bytes.toString('utf8')).toContain('Name,Value');
    expect(generateArtifactV12(inputs[2]).bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(generateArtifactV12(inputs[3]).bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(generateArtifactV12(inputs[4]).bytes.readUInt32LE(0)).toBe(0x04034b50);
  });

  it('reports zero-cost status and returns verified downloadable bytes', async () => {
    const status = await request(app()).get('/api/artifacts/v1.2/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ version: '1.2', freeOnly: true, costUsd: 0, paidFallbackEnabled: false, persistence: 'client-save-only' });

    const response = await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'pdf', title: 'Audit', content: 'Harmless public content.' });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['x-origin-artifact-verified']).toBe('true');
    expect(response.headers['x-origin-free-only']).toBe('true');
    expect(response.headers['x-origin-cost-usd']).toBe('0');
  });

  it('fails closed for invalid and sensitive requests', async () => {
    expect((await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'exe' })).status).toBe(400);
    const sensitive = await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'markdown', content: 'api_key=xxxxxx' });
    expect(sensitive.status).toBe(422);
    expect(sensitive.body.code).toBe('SENSITIVE_INPUT_BLOCKED');
  });
});
