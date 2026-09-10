import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { artifactSelfTestV12, generateArtifactV12 } from './artifactGeneratorV12.js';
import { createArtifactV12Router } from './artifactV12Router.js';

function app() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(createArtifactV12Router());
  return app;
}

describe('V1.2 real artifacts', () => {
  it('generates verified markdown, csv, pdf, docx, xlsx and pptx bytes', () => {
    const inputs = [
      { type: 'markdown' as const, title: 'Report', content: 'Hello' },
      { type: 'csv' as const, title: 'Data', rows: [['Name', 'Value'], ['A', 1]] },
      { type: 'pdf' as const, title: 'PDF', content: 'Portable document' },
      { type: 'docx' as const, title: 'DOCX', content: 'Word document' },
      { type: 'xlsx' as const, title: 'XLSX', rows: [['Metric', 'Value'], ['Sales', 42]] },
      { type: 'pptx' as const, title: 'Deck', slides: [{ title: 'Overview', content: 'First slide' }, { title: 'Details', content: 'Second slide' }] },
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
    expect(generateArtifactV12(inputs[3]).bytes.includes(Buffer.from('word/document.xml'))).toBe(true);
    expect(generateArtifactV12(inputs[4]).bytes.includes(Buffer.from('xl/workbook.xml'))).toBe(true);
    const pptx = generateArtifactV12(inputs[5]);
    expect(pptx.bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(pptx.bytes.includes(Buffer.from('ppt/presentation.xml'))).toBe(true);
    expect(pptx.bytes.includes(Buffer.from('ppt/slides/slide2.xml'))).toBe(true);
    expect(pptx.mimeType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
  });

  it('passes the bounded runtime generator self-test for every format', () => {
    const selfTest = artifactSelfTestV12();
    expect(selfTest.ready).toBe(true);
    expect(selfTest.formats).toEqual({ markdown: true, csv: true, pdf: true, docx: true, xlsx: true, pptx: true });
  });

  it('reports zero-cost readiness and returns verified downloadable bytes', async () => {
    const status = await request(app()).get('/api/artifacts/v1.2/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ ready: true, version: '1.2', freeOnly: true, costUsd: 0, paidFallbackEnabled: false, persistence: 'client-save-only' });
    expect(status.body.formats).toContain('pptx');
    expect(status.body.generatorSelfTest.pptx).toBe(true);

    const response = await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'pptx', title: 'Audit', slides: [{ title: 'Audit', content: 'Harmless public content.' }] });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(response.headers['x-origin-artifact-verified']).toBe('true');
    expect(response.headers['x-origin-free-only']).toBe('true');
    expect(response.headers['x-origin-cost-usd']).toBe('0');
  });

  it('fails closed for invalid and sensitive requests', async () => {
    expect((await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'exe' })).status).toBe(400);
    expect((await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'pptx', slides: [] })).status).toBe(400);
    expect((await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'xlsx', rows: [[{ nested: true }]] })).status).toBe(400);
    const sensitive = await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'pptx', slides: [{ title: 'Credentials', content: 'api_key=xxxxxx' }] });
    expect(sensitive.status).toBe(422);
    expect(sensitive.body.code).toBe('SENSITIVE_INPUT_BLOCKED');
  });
});
