import { describe, expect, it } from 'vitest';
import { generateOriginSupervisorArtifactsV2 } from './OriginSupervisorV2.js';

describe('OriginSupervisorV2 research deliverables', () => {
  const grounded = [
    '# 調査結果',
    '',
    '## 比較',
    '',
    '| 項目 | A | B |',
    '| --- | --- | --- |',
    '| 料金 | 100円 | 120円 |',
    '| 特徴 | 標準 | 高機能 |',
    '',
    '## 提案',
    '',
    '- 目的に合わせて比較してください。',
  ].join('\n');

  it('generates verified DOCX, PPTX, and XLSX payloads from one grounded result', () => {
    const result = generateOriginSupervisorArtifactsV2(
      ['document', 'presentation', 'spreadsheet'],
      '競合比較',
      grounded,
    );

    expect(result.status).toBe('completed');
    expect(result.completedOutputs).toEqual(['document', 'presentation', 'spreadsheet']);
    expect(result.pendingOutputs).toEqual([]);
    expect(result.artifacts).toHaveLength(3);
    expect(result.richOutputs).toHaveLength(3);

    for (const artifact of result.artifacts) {
      expect(artifact.verified).toBe(true);
      expect(artifact.freeOnly).toBe(true);
      expect(artifact.costUsd).toBe(0);
      expect(artifact.paidFallbackUsed).toBe(false);
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.byteLength).toBeGreaterThan(0);
      expect(Buffer.from(artifact.data, 'base64').length).toBe(artifact.byteLength);
    }

    const xlsx = result.artifacts.find(item => item.artifactType === 'xlsx');
    expect(Buffer.from(xlsx!.data, 'base64').includes(Buffer.from('xl/workbook.xml'))).toBe(true);
    const pptx = result.artifacts.find(item => item.artifactType === 'pptx');
    expect(Buffer.from(pptx!.data, 'base64').includes(Buffer.from('ppt/slides/slide1.xml'))).toBe(true);
  });

  it('keeps spreadsheet pending instead of fabricating a low-quality fallback when no table exists', () => {
    const result = generateOriginSupervisorArtifactsV2(
      ['document', 'spreadsheet'],
      '料金調査',
      [
        '# 調査結果',
        '',
        '料金は100円です。[S1](https://example.com/one)',
        '',
        '別資料では120円です。[S2](https://example.org/two)',
      ].join('\n'),
    );

    expect(result.status).toBe('partial');
    expect(result.completedOutputs).toEqual(['document']);
    expect(result.pendingOutputs).toEqual(['spreadsheet']);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.artifactType).toBe('docx');
  });

  it('returns a truthful partial result for unsupported downstream outputs', () => {
    const result = generateOriginSupervisorArtifactsV2(
      ['document', 'image', 'website'],
      '調査',
      grounded,
    );

    expect(result.status).toBe('partial');
    expect(result.completedOutputs).toEqual(['document']);
    expect(result.pendingOutputs).toEqual(['image', 'website']);
    expect(result.artifacts).toHaveLength(1);
  });

  it('does not fabricate an artifact when none was requested', () => {
    const result = generateOriginSupervisorArtifactsV2(
      ['proposal', 'comparison'],
      '調査',
      grounded,
    );
    expect(result.status).toBe('not-required');
    expect(result.artifacts).toEqual([]);
    expect(result.richOutputs).toEqual([]);
  });

  it('fails closed when generated artifact content contains likely secrets or personal data', () => {
    expect(() => generateOriginSupervisorArtifactsV2(
      ['document'],
      '安全性確認',
      'Authorization: Bearer synthetic_secret_token_123456789',
    )).toThrow('SUPERVISOR_ARTIFACT_SENSITIVE_OUTPUT_BLOCKED');
  });
});
