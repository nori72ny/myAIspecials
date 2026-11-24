import { describe, expect, it, vi } from 'vitest';
import { researchCurrentInformation } from '../legacy/originResearchSource.js';

const { composedResearch, createExecutorSpy } = vi.hoisted(() => {
  const composedResearch = vi.fn();
  const createExecutorSpy = vi.fn((_deps: unknown, _legacy: unknown) => composedResearch);
  return { composedResearch, createExecutorSpy };
});

vi.mock('../search/originSearchGrounding.js', () => ({
  createDefaultOriginResearchExecutor: createExecutorSpy,
}));

import { executeToolWithPermission } from './toolRegistry';

describe('toolRegistry safety boundary', () => {
  const approved = { approved: true, costInUSD: 0, safetyPolicyPassed: true };

  it('fails closed without approval', async () => {
    await expect(executeToolWithPermission('code_interpreter', { code: 'const x = 1' })).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
  });

  it('blocks non-zero cost evidence even when approved', async () => {
    await expect(executeToolWithPermission('code_interpreter', { code: 'const x = 1' }, { approved: true, costInUSD: 0.01 })).rejects.toThrow('SAFETY_POLICY_BLOCKED');
  });

  it('blocks an explicit safety-policy failure', async () => {
    await expect(executeToolWithPermission('code_interpreter', { code: 'const x = 1' }, { approved: true, safetyPolicyPassed: false })).rejects.toThrow('SAFETY_POLICY_BLOCKED');
  });

  it('rejects an unknown runtime tool name', async () => {
    await expect(executeToolWithPermission('shell' as never, {}, approved)).rejects.toThrow('TOOL_NOT_REGISTERED');
  });

  it('keeps raw network unavailable while grounded research fails closed without a query', async () => {
    const result = await executeToolWithPermission('web_search_grounding', {}, approved);
    expect(result).toMatchObject({
      ok: false,
      tool: 'web_search_grounding',
      message: 'A research query is required.',
    });
  });

  it('wires web_search_grounding to the composed grounding executor with the stable no-search fallback', () => {
    expect(createExecutorSpy).toHaveBeenCalledTimes(1);
    expect(createExecutorSpy.mock.calls[0]?.[0]).toEqual({ noSearchFallbackType: 'stable' });
    // The legacy implementation stays on as the composer's own fallback.
    expect(createExecutorSpy.mock.calls[0]?.[1]).toBe(researchCurrentInformation);
  });

  it('serves web_search_grounding through the composed executor and keeps the artifact shape', async () => {
    composedResearch.mockResolvedValue({
      ok: true,
      sources: [{
        title: '猫の平均寿命',
        url: 'https://ja.wikipedia.org/wiki/ネコ',
        excerpt: '猫の平均寿命は12〜15年程度とされる。',
        domain: 'ja.wikipedia.org',
        evidenceLevel: 'snippet',
        sourceAuthority: 'secondary-reference',
        freshness: 'unknown',
      }],
      searchProvider: 'Wikipedia',
    });
    const result = await executeToolWithPermission('web_search_grounding', { query: '猫の平均寿命' }, approved);
    expect(composedResearch).toHaveBeenCalledWith('猫の平均寿命');
    expect(result.ok).toBe(true);
    const artifact = JSON.parse(result.artifact ?? '{}') as { provider?: unknown; sources?: Array<{ title?: string; url?: string }> };
    expect(artifact.provider).toBe('Wikipedia');
    expect(artifact.sources?.[0]?.title).toBe('猫の平均寿命');
    expect(artifact.sources?.[0]?.url).toBe('https://ja.wikipedia.org/wiki/ネコ');
  });

  it('keeps the fail-closed message contract when the composed executor finds nothing', async () => {
    composedResearch.mockResolvedValue({ ok: false, sources: [], failure: { stage: 'web-search', code: 'NO_RESULTS' } });
    const result = await executeToolWithPermission('web_search_grounding', { query: '存在しない話題' }, approved);
    expect(result).toMatchObject({
      ok: false,
      tool: 'web_search_grounding',
      message: 'Grounded research failed closed (NO_RESULTS).',
    });
  });

  it('never executes caller code in-process and fails closed without a configured V14 backend', async () => {
    const result = await executeToolWithPermission('code_interpreter', { code: 'process.env.SHOULD_NOT_EXECUTE = "1"' }, approved);
    expect(result.ok).toBe(false);
    expect(result.artifact).toBeUndefined();
    expect(result.message).toBe('AGENT_CODE_BACKEND_NOT_CONFIGURED');
    expect(process.env.SHOULD_NOT_EXECUTE).toBeUndefined();
  });

  it('rejects natural-language prose passed off as code', async () => {
    const result = await executeToolWithPermission('code_interpreter', { code: '売上データを集計するコードを実行してください' }, approved);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_CODE_PARAMS_INVALID');
  });

  it('dispatches coding work to the V14 pipeline when a delegation port is configured', async () => {
    const dispatched: unknown[] = [];
    const result = await executeToolWithPermission('code_interpreter', {
      mode: 'generate',
      instruction: 'CSVを集計するコードを作成してください',
      language: 'python',
    }, approved, {
      codeDelegation: {
        dispatch: async (request) => {
          dispatched.push(request);
          return { state: 'dispatched', jobId: 'job-test-1', targetKey: 'origin:self' };
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(dispatched).toHaveLength(1);
    const artifact = JSON.parse(result.artifact ?? '{}') as { kind?: string; jobId?: string; completionCertified?: boolean };
    expect(artifact.kind).toBe('coding-job');
    expect(artifact.jobId).toBe('job-test-1');
    // Dispatching is not completion: the artifact must not certify the code.
    expect(artifact.completionCertified).toBe(false);
  });

  it('generates a real verified document instead of echoing the request', async () => {
    const request = '商品A: 1200円×3個。商品B: 800円×2個。売上合計と改善提案を含む完成レポートを作成してください。';
    const result = await executeToolWithPermission('document_generator', {
      title: '売上レポート',
      format: 'markdown',
      brief: request,
      outline: ['進捗サマリー', '主な実績'],
    }, approved);
    expect(result.ok).toBe(true);
    const artifact = JSON.parse(result.artifact ?? '{}') as { kind?: string; verified?: boolean; sha256?: string; filename?: string; content?: string };
    expect(artifact.kind).toBe('document');
    expect(artifact.verified).toBe(true);
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.filename).toContain('売上レポート');
    expect(artifact.content).toContain('# 売上レポート');
    expect(artifact.content).not.toBe(request);
  });

  it('declares markdown bytes/sha256 over the carried content, not the wrapped file', async () => {
    const result = await executeToolWithPermission('document_generator', {
      title: 'M&A 整合性監査',
      format: 'markdown',
      content: '## 所見 1\n\n買手2の対価は 146,660,323.00 元と 146,660,332.00 元で一致しない。',
    }, approved);
    expect(result.ok).toBe(true);
    const artifact = JSON.parse(result.artifact ?? '{}') as {
      format?: string; bytes?: number; sha256?: string; verified?: boolean; content?: string;
    };
    expect(artifact.format).toBe('markdown');
    expect(artifact.verified).toBe(true);
    // The envelope's declared bytes/hash reproduce the delivered
    // content exactly — the same rule the JSON path pins (the K8s
    // deliverable's 225-byte mismatch came from measuring the
    // title-wrapped file instead of the carried body).
    expect(artifact.bytes).toBe(Buffer.byteLength(artifact.content ?? '', 'utf8'));
    const { createHash } = await import('node:crypto');
    expect(artifact.sha256).toBe(createHash('sha256').update(artifact.content ?? '', 'utf8').digest('hex'));
    // The carried content stays the pre-wrap body the display uses:
    // no generated title heading is mixed in.
    expect(artifact.content?.startsWith('## 所見 1')).toBe(true);
  });

  it('carries the csv file text as content with declarations over that text', async () => {
    const result = await executeToolWithPermission('document_generator', {
      title: 'イベント一覧',
      format: 'csv',
      content: 'Event_ID,Loss_Amount_CNY\nOR001,1200000\nOR002,3400000',
    }, approved);
    expect(result.ok).toBe(true);
    const artifact = JSON.parse(result.artifact ?? '{}') as {
      format?: string; bytes?: number; sha256?: string; verified?: boolean; content?: string;
    };
    expect(artifact.format).toBe('csv');
    expect(artifact.verified).toBe(true);
    expect(typeof artifact.content).toBe('string');
    expect(artifact.content).toContain('OR001,1200000');
    expect(artifact.bytes).toBe(Buffer.byteLength(artifact.content ?? '', 'utf8'));
    const { createHash } = await import('node:crypto');
    expect(artifact.sha256).toBe(createHash('sha256').update(artifact.content ?? '', 'utf8').digest('hex'));
  });

  it('carries binary formats as contentBase64 with declarations over the decoded bytes', async () => {
    const result = await executeToolWithPermission('document_generator', {
      title: '資本計算',
      format: 'xlsx',
      content: 'Event_ID,Loss_Amount_CNY\nOR001,1200000\nOR002,3400000',
    }, approved);
    expect(result.ok).toBe(true);
    const artifact = JSON.parse(result.artifact ?? '{}') as {
      format?: string; bytes?: number; sha256?: string; verified?: boolean; content?: string; contentBase64?: string;
    };
    expect(artifact.format).toBe('xlsx');
    expect(artifact.verified).toBe(true);
    // The entity rides as base64, never as text (artifact retrieval
    // R-2): decoding it reproduces exactly the byte count and digest
    // the envelope declares — the generated file itself.
    expect(artifact.content).toBeUndefined();
    expect(typeof artifact.contentBase64).toBe('string');
    const decoded = Buffer.from(artifact.contentBase64 ?? '', 'base64');
    expect(decoded.length).toBe(artifact.bytes);
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(decoded).digest('hex')).toBe(artifact.sha256);
    // The decoded bytes are the generated workbook package.
    expect(decoded.readUInt32LE(0)).toBe(0x04034b50);
    expect(decoded.includes(Buffer.from('xl/workbook.xml'))).toBe(true);
  });

  it('fails closed for a document request without any usable input', async () => {
    const result = await executeToolWithPermission('document_generator', {}, approved);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_DOCUMENT_PARAMS_INVALID');
  });

  it('keeps repository tools pinned to the server-owned repository root', async () => {
    const tree = await executeToolWithPermission('repository_explorer', { root: '/tmp' }, approved);
    expect(tree.ok).toBe(true);
    expect(tree.tool).toBe('repository_explorer');
    const packageFile = await executeToolWithPermission('file_reader', { root: '/tmp', path: 'package.json' }, approved);
    expect(packageFile.ok).toBe(true);
    expect(packageFile.artifact).toContain('"scripts"');
    await expect(executeToolWithPermission('file_reader', { root: '/tmp', path: '.env' }, approved)).rejects.toThrow('PROTECTED_PATH');
  });
});

describe('document_generator structured JSON (artifact format)', () => {
  const approved = { approved: true, costInUSD: 0, safetyPolicyPassed: true };
  const KEYS = ['incident_metadata', 'root_causes', 'affected_resources', 'remediation_plan', 'summary'];
  const bundle = JSON.stringify({
    kind: 'data-analysis',
    content: '- 所見1\n- 所見2',
    outputKind: 'findings',
    findings: [
      { claim: 'Pods were OOMKilled at the 256Mi limit', evidence: 'Container payment-api was OOMKilled (exit code 137), memory usage reached limit 256Mi', file: 'cluster_state.txt', location: 'events', type: 'OOMKilled', severity: 'critical' },
      { claim: 'Liveness probes failed with HTTP 500', evidence: 'Liveness probe failed: HTTP probe failed with statuscode: 500', file: 'cluster_state.txt', location: 'events', type: 'liveness_probe_too_aggressive', severity: 'high' },
    ],
    resources: [{ kind: 'Deployment', name: 'payment-api', namespace: 'prod' }],
    remediations: [{ action: 'Raise the container memory limit', priority: 'high' }],
    coverage: { totalChunks: 4, processedChunks: 4 },
    chunkRange: { offset: 0, count: 4 },
  });

  it('assembles the specified JSON file with all required keys from the analyzer bundle', async () => {
    const result = await executeToolWithPermission('document_generator', {
      format: 'json',
      outputFilename: 'root_cause_analysis.json',
      jsonTopLevelKeys: KEYS,
      content: bundle,
    }, approved);
    expect(result.ok).toBe(true);
    const artifact = JSON.parse(result.artifact ?? '{}') as {
      kind?: string; format?: string; filename?: string; mimeType?: string;
      bytes?: number; sha256?: string; verified?: boolean; verification?: string[]; content?: string;
    };
    expect(artifact.kind).toBe('document');
    expect(artifact.format).toBe('json');
    expect(artifact.filename).toBe('root_cause_analysis.json');
    expect(artifact.mimeType).toBe('application/json; charset=utf-8');
    expect(artifact.verified).toBe(true);
    expect(artifact.verification).toContain('json-valid');
    expect(artifact.verification).toContain('json-keys');
    // The envelope's declared bytes/hash reproduce the delivered
    // content exactly (the K8s deliverable's 225-byte mismatch).
    expect(artifact.bytes).toBe(Buffer.byteLength(artifact.content ?? '', 'utf8'));
    const { createHash } = await import('node:crypto');
    expect(artifact.sha256).toBe(createHash('sha256').update(artifact.content ?? '', 'utf8').digest('hex'));
    const report = JSON.parse(artifact.content ?? '{}') as Record<string, unknown>;
    expect(Object.keys(report)).toEqual(KEYS);
    const rootCauses = report.root_causes as Array<Record<string, unknown>>;
    expect(rootCauses).toHaveLength(2);
    expect(rootCauses[0]).toEqual({
      type: 'OOMKilled',
      severity: 'critical',
      description: 'Pods were OOMKilled at the 256Mi limit',
      evidence: ['Container payment-api was OOMKilled (exit code 137), memory usage reached limit 256Mi'],
    });
    expect(rootCauses[1].type).toBe('liveness_probe_too_aggressive');
    expect(report.affected_resources).toEqual([{ kind: 'Deployment', name: 'payment-api', namespace: 'prod' }]);
    expect(report.remediation_plan).toEqual([{ action: 'Raise the container memory limit', priority: 'high' }]);
    expect(typeof report.summary).toBe('string');
    expect((report.summary as string).length).toBeGreaterThan(0);
    expect(report.incident_metadata).toEqual({ safe_to_rollback: false });
  });

  it('defaults missing type and severity instead of inventing them', async () => {
    const plainBundle = JSON.stringify({
      kind: 'data-analysis',
      content: '- 所見',
      outputKind: 'findings',
      findings: [{ claim: '所見', evidence: '', file: 'a.txt', location: '' }],
      coverage: { totalChunks: 1, processedChunks: 1 },
    });
    const result = await executeToolWithPermission('document_generator', {
      format: 'json',
      outputFilename: 'report.json',
      jsonTopLevelKeys: ['root_causes', 'summary'],
      content: plainBundle,
    }, approved);
    expect(result.ok).toBe(true);
    const report = JSON.parse((JSON.parse(result.artifact ?? '{}') as { content?: string }).content ?? '{}') as {
      root_causes: Array<{ type: string; severity: string; evidence: string[] }>;
    };
    expect(report.root_causes[0]).toEqual({
      type: 'finding',
      severity: 'medium',
      description: '所見',
      evidence: [],
    });
  });

  it('fails closed when the bundle has no findings to fill root_causes', async () => {
    const emptyBundle = JSON.stringify({
      kind: 'data-analysis', content: '', outputKind: 'findings', findings: [],
      coverage: { totalChunks: 1, processedChunks: 1 },
    });
    const result = await executeToolWithPermission('document_generator', {
      format: 'json',
      outputFilename: 'report.json',
      jsonTopLevelKeys: KEYS,
      content: emptyBundle,
    }, approved);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_DOCUMENT_JSON_INVALID');
  });

  it('fails closed when the required keys cannot be resolved', async () => {
    const result = await executeToolWithPermission('document_generator', {
      format: 'json',
      outputFilename: 'report.json',
      jsonTopLevelKeys: [],
      content: bundle,
    }, approved);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('AGENT_DOCUMENT_JSON_KEYS_UNRESOLVED');
  });

  it('fails closed for rendered text instead of a bundle, and for an unsafe file name', async () => {
    const rendered = await executeToolWithPermission('document_generator', {
      format: 'json',
      outputFilename: 'report.json',
      jsonTopLevelKeys: KEYS,
      content: '- 所見1（根拠: 引用）',
    }, approved);
    expect(rendered.ok).toBe(false);
    expect(rendered.message).toBe('AGENT_DOCUMENT_JSON_INVALID');
    const traversal = await executeToolWithPermission('document_generator', {
      format: 'json',
      outputFilename: '../report.json',
      jsonTopLevelKeys: KEYS,
      content: bundle,
    }, approved);
    expect(traversal.ok).toBe(false);
    expect(traversal.message).toBe('AGENT_DOCUMENT_PARAMS_INVALID');
  });

  it('uses the specified file name for a markdown document, and refuses a mismatched one', async () => {
    const result = await executeToolWithPermission('document_generator', {
      title: '監査報告',
      format: 'markdown',
      brief: '監査の要旨',
      outline: ['所見'],
      outputFilename: 'audit_report.md',
    }, approved);
    expect(result.ok).toBe(true);
    const artifact = JSON.parse(result.artifact ?? '{}') as { filename?: string };
    expect(artifact.filename).toBe('audit_report.md');
    const mismatched = await executeToolWithPermission('document_generator', {
      title: '監査報告',
      format: 'markdown',
      brief: '監査の要旨',
      outputFilename: 'audit_report.json',
    }, approved);
    expect(mismatched.ok).toBe(false);
    expect(mismatched.message).toBe('AGENT_DOCUMENT_PARAMS_INVALID');
  });
});

describe('document_generator multi-file roles (対策6)', () => {
  const approved = { approved: true, costInUSD: 0, safetyPolicyPassed: true };
  const bundle = JSON.stringify({
    kind: 'data-analysis',
    content: 'Event_ID,Loss_Amount_CNY\nOR001,100',
    outputKind: 'rows',
    rows: [
      { Loss_Amount_CNY: '100', Business_Line: 'BL2', Event_ID: 'OR001', Loss_Event_Category: 'EL1' },
      { Loss_Amount_CNY: '200', Business_Line: 'BL3', Event_ID: 'OR002', Loss_Event_Category: 'EL2' },
    ],
    aggregates: { Loss_Amount_CNY: { sum: 300, count: 2 } },
    biaInputs: {
      alphaText: '0.15',
      grossIncomeByYear: { '2021': 2850000000, '2022': 3120000000, '2023': -456000000 },
    },
    coverage: { totalChunks: 5, processedChunks: 5, keyCount: 2, discardedRows: 0 },
    chunkRange: { offset: 4, count: 1 },
  });
  const COLUMNS = ['Event_ID', 'Loss_Event_Category', 'Business_Line', 'Loss_Amount_CNY'];

  it('renders the rows CSV in the schema column order, whatever order the bundle rows carry', async () => {
    const result = await executeToolWithPermission('document_generator', {
      outputRole: 'rows-csv',
      outputFilename: 'classified_events.csv',
      outputColumns: COLUMNS,
      dataGrounded: true,
      content: bundle,
    }, approved);
    expect(result.ok).toBe(true);
    const artifact = JSON.parse(result.artifact ?? '{}') as { format?: string; filename?: string; mimeType?: string; content?: string; bytes?: number };
    expect(artifact.format).toBe('csv');
    expect(artifact.filename).toBe('classified_events.csv');
    expect(artifact.mimeType).toBe('text/csv; charset=utf-8');
    expect(artifact.content).toBe([
      'Event_ID,Loss_Event_Category,Business_Line,Loss_Amount_CNY',
      'OR001,EL1,BL2,100',
      'OR002,EL2,BL3,200',
    ].join('\n'));
    expect(artifact.bytes).toBe(Buffer.byteLength(artifact.content ?? '', 'utf8'));
  });

  it('assembles the capital calculation deterministically from the bundle BIA inputs', async () => {
    const result = await executeToolWithPermission('document_generator', {
      outputRole: 'capital-json',
      outputFilename: 'capital_calculation.json',
      dataGrounded: true,
      content: bundle,
    }, approved);
    expect(result.ok).toBe(true);
    const artifact = JSON.parse(result.artifact ?? '{}') as { format?: string; content?: string };
    expect(artifact.format).toBe('json');
    const report = JSON.parse(artifact.content ?? '{}') as Record<string, unknown>;
    expect(report).toEqual({
      alpha_coefficient: 0.15,
      gross_income_years: { '2021': 2850000000, '2022': 3120000000, '2023': -456000000 },
      positive_gi_sum_cny: 5970000000,
      number_of_years: 3,
      average_annual_gi_cny: 1990000000,
      or_regulatory_capital_cny: 298500000,
    });
  });

  it('fails the capital step closed when the bundle carries no BIA inputs', async () => {
    const bare = JSON.stringify({ kind: 'data-analysis', outputKind: 'rows', rows: [] });
    const result = await executeToolWithPermission('document_generator', {
      outputRole: 'capital-json',
      outputFilename: 'capital_calculation.json',
      dataGrounded: true,
      content: bare,
    }, approved);
    expect(result.ok).toBe(false);
  });

  it('generates the execution log from the plan profile and the bundle trace', async () => {
    const result = await executeToolWithPermission('document_generator', {
      outputRole: 'execution-log',
      outputFilename: 'execution_log.txt',
      outputFileNames: ['classified_events.csv', 'capital_calculation.json', 'execution_log.txt'],
      logFiles: [{ name: 'events.tsv', kind: 'table', rowCount: 2, charCount: 500 }],
      logRequiredColumns: COLUMNS,
      dataGrounded: true,
      content: bundle,
    }, approved);
    expect(result.ok).toBe(true);
    const artifact = JSON.parse(result.artifact ?? '{}') as { format?: string; mimeType?: string; content?: string };
    expect(artifact.format).toBe('txt');
    expect(artifact.mimeType).toBe('text/plain; charset=utf-8');
    expect(artifact.content).toContain('events.tsv');
    expect(artifact.content).toContain('298500000');
    expect(artifact.content).toContain('classified_events.csv');
  });

  it('rejects an unknown role and a file name whose extension mismatches the role', async () => {
    const unknown = await executeToolWithPermission('document_generator', {
      outputRole: 'spreadsheet',
      outputFilename: 'classified_events.csv',
      dataGrounded: true,
      content: bundle,
    }, approved);
    expect(unknown.ok).toBe(false);
    expect(unknown.message).toBe('AGENT_DOCUMENT_PARAMS_INVALID');
    const mismatched = await executeToolWithPermission('document_generator', {
      outputRole: 'rows-csv',
      outputFilename: 'classified_events.json',
      dataGrounded: true,
      content: bundle,
    }, approved);
    expect(mismatched.ok).toBe(false);
    expect(mismatched.message).toBe('AGENT_DOCUMENT_PARAMS_INVALID');
  });
});
