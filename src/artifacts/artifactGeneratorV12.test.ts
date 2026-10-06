import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { artifactSelfTestV12, generateArtifactV12, generateArtifactV12Async } from './artifactGeneratorV12.js';
import { createArtifactV12Router } from './artifactV12Router.js';

function app() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(createArtifactV12Router());
  return app;
}

const binaryParser: any = (res: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', (error) => callback(error as Error));
};

describe('V1.2 real artifacts', () => {
  it.each(['markdown', 'csv', 'docx', 'xlsx', 'pptx'] as const)('delivers %s with a Japanese download filename', async (type) => {
    const response = await request(app()).post('/api/artifacts/v1.2/generate').send({ type, title: '営業資料', content: '売上の確認' });
    expect(response.status).toBe(200);
    const disposition = response.headers['content-disposition'];
    expect(disposition).toMatch(/^[\x20-\x7e]+$/);
    const encoded = disposition.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(encoded)).toBe(`営業資料.${type === 'markdown' ? 'md' : type}`);
    expect(response.headers['x-origin-artifact-verified']).toBe('true');
  });

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

  it('preserves Japanese text in DOCX, XLSX, and PPTX package content', () => {
    const docx = generateArtifactV12({ type: 'docx', title: '日本語資料', content: '売上レポート\n前年比を確認' });
    expect(docx.bytes.includes(Buffer.from('売上レポート', 'utf8'))).toBe(true);

    const xlsx = generateArtifactV12({ type: 'xlsx', title: '売上表', rows: [['商品', '数量'], ['商品A', 10]] });
    expect(xlsx.bytes.includes(Buffer.from('商品A', 'utf8'))).toBe(true);
    expect(xlsx.bytes.includes(Buffer.from('<c r="B2"><v>10</v></c>'))).toBe(true);

    const pptx = generateArtifactV12({
      type: 'pptx',
      title: '営業提案',
      slides: [{ title: '結論', content: '売上向上の施策です。' }],
    });
    expect(pptx.bytes.includes(Buffer.from('結論', 'utf8'))).toBe(true);
    expect(pptx.bytes.includes(Buffer.from('売上向上の施策です。', 'utf8'))).toBe(true);
  });

  it('adds professional default styling to DOCX, XLSX, and PPTX artifacts', () => {
    const docx = generateArtifactV12({
      type: 'docx',
      title: '営業提案',
      content: '# 課題\n本文\n## 次のアクション\n実行内容',
    });
    const docxBody = docx.bytes.toString('utf8');
    expect(docxBody).toContain('word/styles.xml');
    expect(docxBody).toContain('w:styleId="Title"');
    expect(docxBody).toContain('w:styleId="Heading1"');
    expect(docxBody).toContain('w:styleId="Heading2"');

    const xlsx = generateArtifactV12({
      type: 'xlsx',
      title: '売上管理',
      rows: [['商品', '売上', '達成'], ['A', 120000, true], ['B', 95000, false]],
    });
    const xlsxBody = xlsx.bytes.toString('utf8');
    expect(xlsxBody).toContain('xl/styles.xml');
    expect(xlsxBody).toContain('state="frozen"');
    expect(xlsxBody).toContain('<autoFilter ref="A1:C3"/>');
    expect(xlsxBody).toContain('fgColor rgb="FF0F6CBD"');

    const pptx = generateArtifactV12({
      type: 'pptx',
      title: '経営会議',
      slides: [{ title: '結論', content: '- 売上を伸ばす\n- 継続率を改善する' }],
    });
    const pptxBody = pptx.bytes.toString('utf8');
    expect(pptxBody).toContain('name="Background"');
    expect(pptxBody).toContain('name="Accent"');
    expect(pptxBody).toContain('name="ContentCard"');
    expect(pptxBody).toContain('0F6CBD');
    expect(pptxBody).toContain('• 売上を伸ばす');
  });

  it('preserves numeric and boolean XLSX cell types instead of stringifying every value', () => {
    const artifact = generateArtifactV12({
      type: 'xlsx',
      title: 'Typed data',
      rows: [['Metric', 'Value', 'Enabled'], ['Sales', 42.5, true]],
    });
    const body = artifact.bytes.toString('utf8');
    expect(body).toContain('<c r="B2"><v>42.5</v></c>');
    expect(body).toContain('<c r="C2" t="b"><v>1</v></c>');
    expect(body).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Sales</t></is></c>');
  });

  it('writes explicit XLSX formula cells as formulas without converting ordinary strings', () => {
    const artifact = generateArtifactV12({
      type: 'xlsx',
      title: '売上集計',
      rows: [
        ['項目', '金額'],
        ['A', 1200],
        ['B', 1800],
        ['C', 2200],
        ['合計', { formula: '=SUM(B2:B4)', cachedValue: 5200 }],
        ['説明', '=SUM(B2:B4)'],
      ],
    });
    const body = artifact.bytes.toString('utf8');
    expect(body).toContain('<f>SUM(B2:B4)</f><v>5200</v>');
    expect(body).toContain('calcMode="auto"');
    expect(body).toContain('fullCalcOnLoad="1"');
    expect(body).toContain('<t xml:space="preserve">=SUM(B2:B4)</t>');
    expect(artifact.verification).toContain('xlsx-formulas-preserved');
    expect(artifact.verified).toBe(true);
  });

  it('rejects unsafe XLSX formula functions and formula objects outside XLSX', async () => {
    expect(() => generateArtifactV12({
      type: 'xlsx',
      rows: [['x'], [{ formula: '=WEBSERVICE("https://example.com")' }]],
    })).toThrow('INVALID_ARTIFACT_FORMULA');

    const csvResponse = await request(app()).post('/api/artifacts/v1.2/generate').send({
      type: 'csv',
      rows: [['value'], [{ formula: '=SUM(A1:A2)', cachedValue: 3 }]],
    });
    expect(csvResponse.status).toBe(400);
    expect(csvResponse.body.code).toBe('FORMULA_CELLS_REQUIRE_XLSX');
  });

  it('preserves every PPTX input line by paginating instead of silently truncating at line 20', async () => {
    const content = [...Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`), 'FINAL_SENTINEL_21'].join('\n');
    const artifact = generateArtifactV12({
      type: 'pptx',
      title: 'Stress',
      slides: [{ title: 'Stress', content }],
    });
    const body = artifact.bytes.toString('utf8');
    expect(body).toContain('FINAL_SENTINEL_21');
    expect(body).toContain('ppt/slides/slide3.xml');
    expect(body).toContain('<Slides>3</Slides>');
    expect(artifact.verification).toContain('pptx-content-preserved');
    expect(artifact.verified).toBe(true);

    const response = await request(app()).post('/api/artifacts/v1.2/generate').buffer(true).parse(binaryParser).send({
      type: 'pptx',
      title: 'Stress',
      slides: [{ title: 'Stress', content }],
    });
    expect(response.status).toBe(200);
    expect(response.headers['x-origin-artifact-verified']).toBe('true');
    expect(response.body.includes(Buffer.from('FINAL_SENTINEL_21', 'utf8'))).toBe(true);
  });

  it('accepts explicit XLSX formulas through the production artifact API contract', async () => {
    const response = await request(app()).post('/api/artifacts/v1.2/generate').buffer(true).parse(binaryParser).send({
      type: 'xlsx',
      title: '売上集計',
      rows: [
        ['項目', '金額'],
        ['A', 1200],
        ['B', 1800],
        ['C', 2200],
        ['合計', { formula: '=SUM(B2:B4)', cachedValue: 5200 }],
      ],
    });
    expect(response.status).toBe(200);
    expect(response.headers['x-origin-artifact-verified']).toBe('true');
    expect(response.body.includes(Buffer.from('<f>SUM(B2:B4)</f><v>5200</v>', 'utf8'))).toBe(true);
  });

  it('keeps the legacy sync PDF path fail-closed while the async route renders Japanese safely', async () => {
    expect(() => generateArtifactV12({ type: 'pdf', title: '日本語', content: '営業資料' })).toThrow('PDF_UNICODE_RENDERING_UNAVAILABLE');

    const generated = await generateArtifactV12Async({
      type: 'pdf',
      title: '日本語',
      content: '営業資料\n前年比を確認 ABC 123',
    });
    expect(generated.verified).toBe(true);
    expect(generated.verification).toContain('embedded-unicode-font');
    expect(generated.verification).toContain('unicode-width-aware-layout');
    expect(generated.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(generated.bytes.length).toBeGreaterThan(1000);

    const response = await request(app()).post('/api/artifacts/v1.2/generate').send({
      type: 'pdf',
      title: '日本語',
      content: '営業資料\n前年比を確認 ABC 123',
    });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['x-origin-artifact-verified']).toBe('true');
    expect(response.headers['x-origin-free-only']).toBe('true');
    expect(response.headers['x-origin-cost-usd']).toBe('0');
    const encoded = response.headers['content-disposition'].split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(encoded)).toBe('日本語.pdf');
    expect(response.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 20_000);

  it('fails closed when a glyph is outside the bundled Japanese/Latin font coverage', async () => {
    await expect(generateArtifactV12Async({
      type: 'pdf',
      title: 'Unsupported glyph',
      content: 'Color emoji is intentionally not substituted: 😀',
    })).rejects.toThrow('PDF_UNICODE_GLYPH_UNSUPPORTED');
  });

  it('wraps and paginates PDF text without losing long lines or the end of the document', () => {
    const content = ['W'.repeat(210), ...Array.from({ length: 110 }, (_, i) => `Record ${i + 1}`), 'FINAL RECORD'].join('\n');
    const body = generateArtifactV12({ type: 'pdf', title: 'Report', content }).bytes.toString('ascii');
    expect(body).toContain('/Count 3');
    expect(body).toContain('(FINAL RECORD) Tj');
    const streams = [...body.matchAll(/stream\n([\s\S]*?)\nendstream/g)];
    const textLines = streams.flatMap(([, stream]) => {
      const text = stream.split('\nET')[0]; // Exclude page-number footer.
      return [...text.matchAll(/\(([^()]*)\) Tj/g)].map(match => match[1]);
    });
    expect(textLines.every(line => line.length <= 82)).toBe(true);
    expect(textLines.join('')).toBe(`Report${content.replaceAll('\n', '')}`);
    const offsets = body.split('xref\n')[1].split('\n').slice(2, -1);
    offsets.forEach((entry, index) => {
      if (!/^\d{10} 00000 n/.test(entry)) return;
      expect(body.slice(Number(entry.slice(0, 10)))).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  it('preserves printable PDF escapes and normalizes tabs and CR line breaks', () => {
    const body = generateArtifactV12({ type: 'pdf', content: 'a\tb\rc(d)\\e' }).bytes.toString('ascii');
    expect(body).toContain('(a    b) Tj');
    expect(body).toContain('(c\\(d\\)\\\\e) Tj');
    expect(body).not.toContain('?');
  });

  it('rejects non-finite spreadsheet values before artifact bytes are produced', () => {
    expect(() => generateArtifactV12({ type: 'xlsx', rows: [['x', Number.POSITIVE_INFINITY]] })).toThrow('INVALID_ARTIFACT_ROWS');
    expect(() => generateArtifactV12({ type: 'xlsx', rows: [['x', Number.NaN]] })).toThrow('INVALID_ARTIFACT_ROWS');
  });

  it('passes the bounded runtime generator self-test for every format', () => {
    const selfTest = artifactSelfTestV12();
    expect(selfTest.ready).toBe(true);
    expect(selfTest.formats).toEqual({ markdown: true, csv: true, pdf: true, docx: true, xlsx: true, pptx: true });
  });

  it('reports zero-cost readiness only after the real Unicode PDF path passes', async () => {
    const status = await request(app()).get('/api/artifacts/v1.2/status');
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ ready: true, version: '1.2', freeOnly: true, costUsd: 0, paidFallbackEnabled: false, persistence: 'client-save-only' });
    expect(status.body.formats).toContain('pptx');
    expect(status.body.formatLimitations.pdf).toContain('Embedded Noto Sans JP');
    expect(status.body.formatLimitations.pdf).toContain('unsupported glyphs fail closed');
    expect(status.body.generatorSelfTest.pdf).toBe(true);
    expect(status.body.generatorSelfTest.pptx).toBe(true);

    const response = await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'pptx', title: 'Audit', slides: [{ title: 'Audit', content: 'Harmless public content.' }] });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(response.headers['x-origin-artifact-verified']).toBe('true');
    expect(response.headers['x-origin-free-only']).toBe('true');
    expect(response.headers['x-origin-cost-usd']).toBe('0');
  }, 20_000);

  it('fails closed for invalid and sensitive requests', async () => {
    expect((await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'exe' })).status).toBe(400);
    expect((await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'pptx', slides: [] })).status).toBe(400);
    expect((await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'xlsx', rows: [[{ nested: true }]] })).status).toBe(400);
    const sensitive = await request(app()).post('/api/artifacts/v1.2/generate').send({ type: 'pptx', slides: [{ title: 'Credentials', content: 'api_key=xxxxxx' }] });
    expect(sensitive.status).toBe(422);
    expect(sensitive.body.code).toBe('SENSITIVE_INPUT_BLOCKED');
  });
});
