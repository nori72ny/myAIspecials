// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { generateAgentDocumentV3, documentGenerationConfiguredV3 } from './documentGenerationV3.js';
import { executeToolWithPermission } from './toolRegistry.js';
import { isCapabilityAllowed } from './agentExecutionPolicy.js';
import { DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, ORIGIN_OPENROUTER_FREE_MODEL } from '../lib/orchestration/OriginExecutionPolicy.js';
import type { OriginProviderExecutionResult } from '../legacy/originProviderClient.js';
const env = { ORIGIN_AGENT_DOCUMENT_GENERATION_ENABLED: 'true', OPENROUTER_API_KEY: 'test-only-not-a-real-key' };
const content = '商品Aは1200円を3個、商品Bは800円を2個。売上レポートを作成してください。';
const document = '# 売上レポート\n\n商品A：3600円\n商品B：1600円\n合計：5200円\n\n提案：販売数の変化を継続して確認する。';
const response = (text = document): OriginProviderExecutionResult => ({ text, actualCostUsd: 0, usage: { costUsd: 0 }, providerDataPolicy: DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, routingEvidence: { requestedModel: ORIGIN_OPENROUTER_FREE_MODEL, servedModel: ORIGIN_OPENROUTER_FREE_MODEL, provider: 'OpenRouter', strategy: 'adaptive-primary', attempt: 1, fallbackUsed: false } });

describe('opt-in document generation adapter (provider stub, not live quality proof)', () => {
  it.each([{}, { OPENROUTER_API_KEY: 'test-only' }, { ORIGIN_AGENT_DOCUMENT_GENERATION_ENABLED: 'true' }])('does not call a provider without complete explicit configuration', async disabled => {
    const execute = vi.fn();
    expect(documentGenerationConfiguredV3(disabled)).toBe(false);
    expect(await generateAgentDocumentV3({ content }, { env: disabled, execute })).toMatchObject({ ok: false, message: 'AGENT_DOCUMENT_GENERATION_UNAVAILABLE' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('uses the existing zero-cost route and returns the actual provider draft intact', async () => {
    const execute = vi.fn(async () => response());
    expect(await generateAgentDocumentV3({ content }, { env, execute })).toMatchObject({ ok: true, artifact: document });
    expect(execute).toHaveBeenCalledTimes(1);
    const call = execute.mock.calls[0] as unknown as [{ plan: { freeOnly: boolean; providerDataPolicy: unknown }; messages: unknown[] }];
    expect(call[0].plan.freeOnly).toBe(true);
    expect(call[0].plan.providerDataPolicy).toEqual(DEFAULT_ORIGIN_PROVIDER_DATA_POLICY);
    expect(call[0].messages).toEqual([{ role: 'user', content }]);
    expect(JSON.stringify(call[0])).not.toContain(env.OPENROUTER_API_KEY);
  });
  it.each(['', 'a'.repeat(12001)])('rejects invalid inputs before provider execution', async value => {
    const execute = vi.fn();
    expect((await generateAgentDocumentV3({ content: value }, { env, execute })).ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not claim to produce an unsupported Office file', async () => {
    const execute = vi.fn();
    expect((await generateAgentDocumentV3({ content, format: 'docx' }, { env, execute })).message).toBe('AGENT_DOCUMENT_FORMAT_UNSUPPORTED');
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([content, '', 'x'.repeat(120001), '<script>alert(1)</script>', 'hello\u0000world'])('rejects echoed, invalid or active output', async text => {
    const result = await generateAgentDocumentV3({ content }, { env, execute: async () => response(text) });
    expect(result.ok).toBe(false);
    expect(result.artifact).toBeUndefined();
  });
  it('rejects non-zero or absent cost evidence', async () => {
    for (const result of [{ ...response(), actualCostUsd: 1 }, { ...response(), usage: undefined }]) {
      expect((await generateAgentDocumentV3({ content }, { env, execute: async () => result as never })).ok).toBe(false);
    }
  });
  it('rejects a paid fallback or a different provider', async () => {
    for (const evidence of [{ ...response().routingEvidence, fallbackUsed: true }, { ...response().routingEvidence, provider: 'unknown' }]) {
      expect((await generateAgentDocumentV3({ content }, { env, execute: async () => ({ ...response(), routingEvidence: evidence }) })).ok).toBe(false);
    }
  });
  it('requires privacy-policy evidence from the provider result', async () => {
    const result = { ...response(), providerDataPolicy: { ...DEFAULT_ORIGIN_PROVIDER_DATA_POLICY, requireZeroDataRetention: false } };
    expect((await generateAgentDocumentV3({ content }, { env, execute: async () => result })).message).toBe('AGENT_DOCUMENT_PRIVACY_POLICY_UNVERIFIED');
  });
  it('does not expose provider exceptions or retry them', async () => {
    const execute = vi.fn(async () => { throw new Error('secret-in-upstream-error'); });
    const result = await generateAgentDocumentV3({ content }, { env, execute });
    expect(result).toEqual({ ok: false, tool: 'document_generator', message: 'AGENT_DOCUMENT_PROVIDER_EXECUTION_FAILED' });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('does not activate legacy callers from ambient environment flags', async () => {
    vi.stubEnv('ORIGIN_AGENT_DOCUMENT_GENERATION_ENABLED', 'true');
    vi.stubEnv('OPENROUTER_API_KEY', 'test-only');
    try {
      expect(await executeToolWithPermission('document_generator', { content }, { approved: true, safetyPolicyPassed: true, costInUSD: 0 })).toMatchObject({ ok: false, message: 'AGENT_DOCUMENT_GENERATION_UNAVAILABLE' });
    } finally { vi.unstubAllEnvs(); }
  });
  it('blocks recognizable secrets before sending and after receiving', async () => {
    const privateKeyHeader = ['-----BEGIN ', 'PRIVATE KEY', '-----'].join('');
    const execute = vi.fn(async () => response());
    expect((await generateAgentDocumentV3({ content: privateKeyHeader }, { env, execute })).message).toBe('AGENT_DOCUMENT_SENSITIVE_INPUT_BLOCKED');
    expect(execute).not.toHaveBeenCalled();
    expect((await generateAgentDocumentV3({ content }, { env, execute: async () => response(privateKeyHeader) })).message).toBe('AGENT_DOCUMENT_SENSITIVE_OUTPUT_BLOCKED');
  });
  it('requires distinct document permission and exact-operation approval before execution', async () => {
    expect(isCapabilityAllowed({ capability: 'draft_document', explicitIntent: false, securityPolicyPassed: true })).toBe(false);
    expect(isCapabilityAllowed({ capability: 'draft_document', explicitIntent: true, securityPolicyPassed: true })).toBe(true);
    await expect(executeToolWithPermission('document_generator', { content }, { approved: false }, env)).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
    await expect(executeToolWithPermission('document_generator', { content }, { approved: true, safetyPolicyPassed: true, costInUSD: 1 }, env)).rejects.toThrow('ZERO_COST_BOUNDARY_BLOCKED');
  });
});
