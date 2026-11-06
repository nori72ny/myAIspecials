import { describe, expect, it } from 'vitest';
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
