// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createAgentTaskGraph } from './agentTaskGraph.js';
import { executeNextTask, type ExecutorTool, type ExecutorVerification } from './taskGraphExecutor.js';

/**
 * Diagnostic channel separation (K-17 target B, design
 * AGENT_K17_FAILED_STEP_ARTIFACT_DESIGN_2026-11-24 §5): a payload a
 * failed tool attaches for diagnosis rides the record's
 * diagnosticArtifact, strictly apart from the dataflow artifact.
 * The dataflow artifact of a failed step stays '', verification
 * never sees the diagnostic payload, and the channel exists only
 * on failure records.
 */

const okVerify: ExecutorVerification = async (result) => ({ ok: true, artifact: result.artifact, attempts: 0 });

describe('taskGraphExecutor diagnostic channel (K-17, PR-β)', () => {
  it('carries a failed tool\'s diagnostic attachment on the separate channel, never as the artifact', async () => {
    const graph = createAgentTaskGraph('goal', ['analyze']);
    const bundle = JSON.stringify({ kind: 'data-analysis', rows: [{ id: 'A-1' }] });
    const tool: ExecutorTool = async () => ({
      ok: false,
      message: 'AGENT_DATA_COVERAGE_INSUFFICIENT (対象3件中2件を処理)',
      diagnosticArtifact: bundle,
    });
    const verify = vi.fn(okVerify);

    const { record } = await executeNextTask(graph, tool, verify);

    expect(record?.status).toBe('failed');
    // The dataflow artifact stays empty: nothing downstream can
    // resolve the failed step's payload as an input.
    expect(record?.artifact).toBe('');
    expect(record?.diagnosticArtifact).toBe(bundle);
    expect(record?.toolFailureMessage).toContain('AGENT_DATA_COVERAGE_INSUFFICIENT');
    // Verification is a success-path gate; a failed tool's payload
    // is never put in front of it.
    expect(verify).not.toHaveBeenCalled();
  });

  it('leaves the channel unset when a failed tool attaches nothing', async () => {
    const graph = createAgentTaskGraph('goal', ['analyze']);
    const tool: ExecutorTool = async () => ({ ok: false, message: 'PROVIDER_TIMEOUT' });

    const { record } = await executeNextTask(graph, tool, okVerify);

    expect(record?.status).toBe('failed');
    expect(record?.artifact).toBe('');
    expect(record).not.toHaveProperty('diagnosticArtifact');
  });

  it('drops a diagnostic attachment on a successful result: the channel is failure-only', async () => {
    const graph = createAgentTaskGraph('goal', ['analyze']);
    const tool: ExecutorTool = async () => ({
      ok: true,
      artifact: 'REAL ARTIFACT',
      diagnosticArtifact: 'MUST NOT SURVIVE',
    });

    const { record } = await executeNextTask(graph, tool, okVerify);

    expect(record?.status).toBe('completed');
    expect(record?.artifact).toBe('REAL ARTIFACT');
    expect(record).not.toHaveProperty('diagnosticArtifact');
  });
});

/**
 * Model-call timing channel (D7 countermeasure A): unlike the
 * failure-only diagnostic channel above, a step's dispatch timings
 * ride the record on BOTH branches — the successful calls are
 * exactly what the timing record exists to account for.
 */
describe('taskGraphExecutor model-call timing channel (D7 countermeasure A)', () => {
  const timings = [{ providerId: 'groq-free', modelId: 'openai/gpt-oss-120b', outcome: 'succeeded' as const, durationMs: 321 }];

  it('carries a successful tool\'s timings on the record', async () => {
    const graph = createAgentTaskGraph('goal', ['analyze']);
    const tool: ExecutorTool = async () => ({ ok: true, artifact: 'REAL ARTIFACT', modelCallTimings: timings });
    const { record } = await executeNextTask(graph, tool, okVerify);
    expect(record?.status).toBe('completed');
    expect(record?.modelCallTimings).toEqual(timings);
  });

  it('carries a failed tool\'s timings on the record too', async () => {
    const graph = createAgentTaskGraph('goal', ['analyze']);
    const tool: ExecutorTool = async () => ({ ok: false, message: 'PROVIDER_TIMEOUT', modelCallTimings: timings });
    const { record } = await executeNextTask(graph, tool, okVerify);
    expect(record?.status).toBe('failed');
    expect(record?.artifact).toBe('');
    expect(record?.modelCallTimings).toEqual(timings);
  });

  it('leaves the channel unset when the tool reports no timings', async () => {
    const graph = createAgentTaskGraph('goal', ['analyze']);
    const tool: ExecutorTool = async () => ({ ok: true, artifact: 'REAL ARTIFACT' });
    const { record } = await executeNextTask(graph, tool, okVerify);
    expect(record?.status).toBe('completed');
    expect(record).not.toHaveProperty('modelCallTimings');
  });
});
