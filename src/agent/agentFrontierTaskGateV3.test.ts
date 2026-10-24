import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AGENT_FRONTIER_TASK_GATE_VERSION_V3,
  canonicalAgentFrontierEvidenceV3,
  type AgentFrontierGateInputV3,
  evaluateAgentFrontierTaskGateV3,
  type AgentFrontierFamilyV3,
  type AgentFrontierTaskEvidenceV3,
} from './agentFrontierTaskGateV3.js';

const sha = 'a'.repeat(40);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const pair = generateKeyPairSync('ed25519');
const independentConfig = {
  ORIGIN_AGENT_FRONTIER_CORPUS_SHA256: digest('sealed independent 24-task corpus fixture'),
  ORIGIN_AGENT_FRONTIER_RUN_ID: 'sealed-evaluator-run-1',
  ORIGIN_AGENT_FRONTIER_CANDIDATE_SHA: sha,
  ORIGIN_AGENT_FRONTIER_EVALUATOR_PUBLIC_KEY_PEM: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
} as NodeJS.ProcessEnv;

function signedInput(tasks: AgentFrontierTaskEvidenceV3[]): AgentFrontierGateInputV3 {
  const input: AgentFrontierGateInputV3 = {
    version: AGENT_FRONTIER_TASK_GATE_VERSION_V3,
    candidateSha: sha,
    tasks,
    attestation: {
      corpusDigest: independentConfig.ORIGIN_AGENT_FRONTIER_CORPUS_SHA256!,
      evaluationRunId: independentConfig.ORIGIN_AGENT_FRONTIER_RUN_ID!,
      signature: '',
    },
  };
  const message = canonicalAgentFrontierEvidenceV3(input);
  input.attestation!.signature = sign(null, Buffer.from(message, 'utf8'), pair.privateKey).toString('base64url');
  return input;
}

function score(tasks: AgentFrontierTaskEvidenceV3[]) {
  return evaluateAgentFrontierTaskGateV3(signedInput(tasks), independentConfig);
}

function task(id: string, family: AgentFrontierFamilyV3, status: AgentFrontierTaskEvidenceV3['status'] = 'SOLVED'): AgentFrontierTaskEvidenceV3 {
  return {
    id,
    candidateSha: sha,
    family,
    status,
    originalTaskDigest: digest(`original:${id}`),
    planEvidenceDigest: digest(`plan:${id}`),
    toolEvidenceDigest: digest(`execution:${id}`),
    terminalEvidenceDigest: digest(`terminal:${id}`),
    verifiedTerminal: status === 'SOLVED',
    falseCompletionClaims: 0,
    p0Defects: 0,
    p1Defects: 0,
    securityPassed: true,
    costUsd: 0,
    paidFallbackUsed: false,
    elapsedMs: 1_000,
    timeBudgetMs: 60_000,
  };
}

function suite(): AgentFrontierTaskEvidenceV3[] {
  return [
    ...Array.from({ length: 12 }, (_, i) => task(`coding-${i + 1}`, 'coding-repository')),
    ...Array.from({ length: 8 }, (_, i) => task(`agent-${i + 1}`, 'agent-multi-step')),
    ...Array.from({ length: 4 }, (_, i) => task(`artifact-${i + 1}`, 'artifact-deliverable')),
  ];
}

describe('evaluateAgentFrontierTaskGateV3', () => {
  it('passes only a fully measured, verified, zero-cost 24-task suite', () => {
    const result = score(suite());
    expect(result.passed).toBe(true);
    expect(result.attempted).toBe(24);
    expect(result.measured).toBe(24);
    expect(result.solved).toBe(24);
    expect(result.solveRate).toBe(1);
  });

  it('treats infrastructure-not-measured as a blocker rather than a quality pass', () => {
    const tasks = suite();
    tasks[0] = task('coding-1', 'coding-repository', 'NOT_MEASURED');
    const result = score(tasks);
    expect(result.passed).toBe(false);
    expect(result.measured).toBe(23);
    expect(result.blockers).toContain('ALL_24_TASKS_MUST_BE_MEASURED');
  });

  it('fails at 21 of 24 solved because the overall solve rate is below 90 percent', () => {
    const tasks = suite();
    tasks[0] = task('coding-1', 'coding-repository', 'UNSOLVED');
    tasks[12] = task('agent-1', 'agent-multi-step', 'UNSOLVED');
    tasks[20] = task('artifact-1', 'artifact-deliverable', 'UNSOLVED');
    const result = score(tasks);
    expect(result.solved).toBe(21);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('OVERALL_SOLVE_RATE_BELOW_90_PERCENT');
  });

  it('requires at least 80 percent solve rate in every family', () => {
    const tasks = suite();
    tasks[20] = task('artifact-1', 'artifact-deliverable', 'UNSOLVED');
    const result = score(tasks);
    expect(result.solveRate).toBeGreaterThan(0.9);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('FAMILY_SOLVE_RATE_BELOW_THRESHOLD:artifact-deliverable');
  });

  it('hard-fails any false completion or P0/P1 defect', () => {
    const tasks = suite();
    tasks[0] = { ...tasks[0], falseCompletionClaims: 1 };
    tasks[1] = { ...tasks[1], p1Defects: 1 };
    const result = score(tasks);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('FALSE_COMPLETION_PRESENT');
    expect(result.blockers).toContain('P1_DEFECT_PRESENT');
  });

  it('does not accept SOLVED without verified terminal evidence and exact zero-cost proof', () => {
    const tasks = suite();
    tasks[0] = { ...tasks[0], verifiedTerminal: false, costUsd: 0.01 };
    const result = score(tasks);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('ZERO_COST_GATE_FAILED');
    expect(result.blockers.some(code => code.includes('TASK_SOLVED_WITHOUT_VERIFIED_TERMINAL'))).toBe(true);
  });

  it('requires the frozen 12/8/4 family composition', () => {
    const tasks = suite();
    tasks[0] = { ...tasks[0], family: 'agent-multi-step' };
    const result = score(tasks);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('FAMILY_COUNT_INVALID:coding-repository');
    expect(result.blockers).toContain('FAMILY_COUNT_INVALID:agent-multi-step');
  });

  it('rejects substituted easy tasks even if the 12/8/4 family counts remain correct', () => {
    const tasks = suite();
    tasks[0] = { ...tasks[0], id: 'coding-unapproved' };
    const result = score(tasks);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('coding-unapproved:TASK_FROZEN_ID_OR_FAMILY_INVALID');
  });

  it('rejects missing terminal, plan or tool evidence for a claimed solved task', () => {
    const tasks = suite();
    tasks[0] = { ...tasks[0], planEvidenceDigest: '', terminalEvidenceDigest: '' };
    tasks[1] = { ...tasks[1], toolEvidenceDigest: '0'.repeat(64) };
    const result = score(tasks);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('coding-1:TASK_PLAN_EVIDENCE_MISSING');
    expect(result.blockers).toContain('coding-1:TASK_TERMINAL_DIGEST_MISSING');
    expect(result.blockers).toContain('coding-2:TASK_TOOL_EVIDENCE_MISSING');
  });

  it('rejects duplicated task digests and absent original task provenance', () => {
    const tasks = suite();
    tasks[0] = { ...tasks[0], originalTaskDigest: '' };
    tasks[1] = { ...tasks[1], originalTaskDigest: tasks[2].originalTaskDigest };
    const result = score(tasks);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('coding-1:TASK_ORIGINAL_DIGEST_INVALID');
    expect(result.blockers).toContain('TASK_ORIGINAL_DIGESTS_DUPLICATE');
  });

  it('blocks structurally perfect synthetic scores without trusted evaluator signing configuration', () => {
    const fake = signedInput(suite());
    const unsigned = { ...fake, attestation: undefined };
    expect(evaluateAgentFrontierTaskGateV3(fake, {}).blockers).toContain('EVALUATOR_TRUST_ANCHOR_UNAVAILABLE');
    expect(evaluateAgentFrontierTaskGateV3(unsigned, independentConfig).blockers).toContain('INDEPENDENT_ATTESTATION_MISSING');
    expect(evaluateAgentFrontierTaskGateV3(unsigned, independentConfig).passed).toBe(false);
  });

  it('rejects payload edits made after evaluator signing even when their shape and scores look valid', () => {
    const data = signedInput(suite());
    const altered = data.tasks.map((row, i) => i === 0 ? { ...row, terminalEvidenceDigest: digest('different terminal') } : row);
    const tampered = { ...data, tasks: altered };
    const result = evaluateAgentFrontierTaskGateV3(tampered, independentConfig);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('INDEPENDENT_ATTESTATION_INVALID');
  });

  it('rejects a replay into a different evaluation run, corpus or candidate SHA', () => {
    const data = signedInput(suite());
    expect(evaluateAgentFrontierTaskGateV3(data, { ...independentConfig, ORIGIN_AGENT_FRONTIER_RUN_ID: 'another-run-2' })
      .blockers).toContain('EVALUATION_RUN_ID_MISMATCH');
    expect(evaluateAgentFrontierTaskGateV3(data, { ...independentConfig, ORIGIN_AGENT_FRONTIER_CORPUS_SHA256: digest('new-corpus') })
      .blockers).toContain('FROZEN_CORPUS_DIGEST_MISMATCH');
    expect(evaluateAgentFrontierTaskGateV3(data, { ...independentConfig, ORIGIN_AGENT_FRONTIER_CANDIDATE_SHA: 'b'.repeat(40) })
      .blockers).toContain('EVALUATOR_CANDIDATE_SHA_MISMATCH');
  });

  it('rejects signatures made by an untrusted key even if all task outcomes claim SOLVED', () => {
    const other = generateKeyPairSync('ed25519');
    const input = signedInput(suite());
    input.attestation!.signature = sign(null, Buffer.from(canonicalAgentFrontierEvidenceV3(input)), other.privateKey).toString('base64url');
    const result = evaluateAgentFrontierTaskGateV3(input, independentConfig);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('INDEPENDENT_ATTESTATION_INVALID');
  });

  it('fails closed on a null evidence row instead of throwing before the release verdict', () => {
    const tasks = suite();
    tasks[0] = null as unknown as AgentFrontierTaskEvidenceV3;
    expect(() => score(tasks)).not.toThrow();
    const result = score(tasks);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain('TASK_EVIDENCE_RECORDS_INVALID');
    expect(result.blockers).toContain('unknown:TASK_EVIDENCE_INVALID');
  });
});
