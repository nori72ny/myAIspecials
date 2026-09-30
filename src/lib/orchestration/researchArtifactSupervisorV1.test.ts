import { describe, expect, it } from 'vitest';
import { buildResearchArtifactSupervisorV1 } from './researchArtifactSupervisorV1.js';

const base = {
  query: '現在の料金を調査して資料にまとめてください',
  requestedOutputs: ['document'],
  language: 'ja' as const,
  sourceCount: 2,
  synthesis: [
    '## 結論',
    '',
    '料金は100円と120円の表記差があります。[S1](https://example.com/one) [S2](https://example.org/two)',
  ].join('\n'),
};

describe('research artifact supervisor v1', () => {
  it('creates a verified Japanese DOCX with provenance and embedded source URLs', () => {
    const result = buildResearchArtifactSupervisorV1(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact).toMatchObject({
      version: 'origin.research-artifact-supervisor.v1',
      output: 'document',
      format: 'docx',
      verified: true,
      freeOnly: true,
      costUsd: 0,
      paidFallbackUsed: false,
      provenance: { derivedFrom: 'grounded-research-synthesis', citationValidated: true, sourceCount: 2 },
    });
    expect(result.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    const bytes = Buffer.from(result.artifact.bytesBase64, 'base64');
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.includes(Buffer.from('word/document.xml'))).toBe(true);
    expect(bytes.includes(Buffer.from('https://example.com/one'))).toBe(true);
  });

  it('turns structured research synthesis into a multi-slide PPTX plus sources', () => {
    const result = buildResearchArtifactSupervisorV1({
      ...base,
      query: '現在の料金を比較調査してPowerPointにまとめてください',
      requestedOutputs: ['presentation'],
      synthesis: [
        '## 結論',
        '料金差が確認されました。[S1](https://example.com/one) [S2](https://example.org/two)',
        '',
        '## 比較',
        '- A: 100円 [S1](https://example.com/one)',
        '- B: 120円 [S2](https://example.org/two)',
        '',
        '## 推奨アクション',
        '- 一次情報を再確認する',
      ].join('\n'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.format).toBe('pptx');
    const bytes = Buffer.from(result.artifact.bytesBase64, 'base64');
    expect(bytes.includes(Buffer.from('ppt/slides/slide1.xml'))).toBe(true);
    expect(bytes.includes(Buffer.from('ppt/slides/slide4.xml'))).toBe(true);
    expect(bytes.includes(Buffer.from('https://example.com/one'))).toBe(true);
  });

  it('creates XLSX only when the citation-validated synthesis contains an explicit table', () => {
    const result = buildResearchArtifactSupervisorV1({
      ...base,
      query: '料金を調査してExcelにまとめてください',
      requestedOutputs: ['spreadsheet'],
      synthesis: [
        '| サービス | 料金 | 出典 |',
        '| --- | ---: | --- |',
        '| A | 100 | [S1](https://example.com/one) |',
        '| B | 120 | [S2](https://example.org/two) |',
      ].join('\n'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.format).toBe('xlsx');
    const bytes = Buffer.from(result.artifact.bytesBase64, 'base64');
    expect(bytes.includes(Buffer.from('xl/workbook.xml'))).toBe(true);
    expect(bytes.includes(Buffer.from('https://example.com/one'))).toBe(true);
  });

  it('fails closed when spreadsheet source structure is missing', () => {
    expect(buildResearchArtifactSupervisorV1({
      ...base,
      requestedOutputs: ['spreadsheet'],
      synthesis: '表ではない文章です。[S1](https://example.com/one)',
    })).toEqual({ ok: false, code: 'RESEARCH_ARTIFACT_TABLE_REQUIRED' });
  });

  it('does not silently choose one file when multiple downstream files were requested', () => {
    expect(buildResearchArtifactSupervisorV1({
      ...base,
      requestedOutputs: ['presentation', 'document'],
    })).toEqual({ ok: false, code: 'RESEARCH_ARTIFACT_MULTIPLE_OUTPUTS_UNSUPPORTED' });
  });

  it('does not claim artifact execution for unsupported downstream outputs', () => {
    expect(buildResearchArtifactSupervisorV1({
      ...base,
      requestedOutputs: ['image'],
    })).toEqual({ ok: false, code: 'RESEARCH_ARTIFACT_NOT_REQUESTED' });
  });
});
