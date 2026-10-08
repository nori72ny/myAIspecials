import { lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AGENT_FRONTIER_TASK_GATE_VERSION_V3,
  evaluateAgentFrontierTaskGateV3,
  type AgentFrontierGateInputV3,
} from '../src/agent/agentFrontierTaskGateV3.js';

const MAX_EVIDENCE_BYTES = 256 * 1024;
const SHA40 = /^[0-9a-f]{40}$/i;
const TASK_KEYS = new Set([
  'id',
  'candidateSha',
  'family',
  'status',
  'verifiedTerminal',
  'falseCompletionClaims',
  'p0Defects',
  'p1Defects',
  'securityPassed',
  'costUsd',
  'paidFallbackUsed',
  'elapsedMs',
  'timeBudgetMs',
]);

function inputPath(): string {
  const value = process.env.ORIGIN_AGENT_FRONTIER_EVIDENCE_PATH;
  if (!value || !value.trim()) throw new Error('AGENT_FRONTIER_EVIDENCE_PATH_REQUIRED');
  return path.resolve(value);
}

function outputPath(): string | null {
  const value = process.env.ORIGIN_AGENT_FRONTIER_QUALIFICATION_OUTPUT_PATH;
  return value?.trim() ? path.resolve(value) : null;
}

function exactObject(value: unknown, keys: ReadonlySet<string>): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => keys.has(key));
}

function parseEvidence(raw: string): AgentFrontierGateInputV3 {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('AGENT_FRONTIER_EVIDENCE_JSON_INVALID');
  }
  if (!exactObject(value, new Set(['version', 'candidateSha', 'tasks']))) {
    throw new Error('AGENT_FRONTIER_EVIDENCE_SCHEMA_INVALID');
  }
  if (value.version !== AGENT_FRONTIER_TASK_GATE_VERSION_V3) {
    throw new Error('AGENT_FRONTIER_EVIDENCE_VERSION_INVALID');
  }
  if (typeof value.candidateSha !== 'string' || !SHA40.test(value.candidateSha)) {
    throw new Error('AGENT_FRONTIER_EVIDENCE_CANDIDATE_INVALID');
  }
  if (!Array.isArray(value.tasks) || value.tasks.length !== 24) {
    throw new Error('AGENT_FRONTIER_EVIDENCE_TASK_COUNT_INVALID');
  }
  for (const task of value.tasks) {
    if (!exactObject(task, TASK_KEYS)) throw new Error('AGENT_FRONTIER_EVIDENCE_TASK_SCHEMA_INVALID');
  }
  return value as unknown as AgentFrontierGateInputV3;
}

async function loadEvidence(filePath: string): Promise<AgentFrontierGateInputV3> {
  const info = await lstat(filePath).catch(() => null);
  if (!info || !info.isFile() || info.isSymbolicLink()) {
    throw new Error('AGENT_FRONTIER_EVIDENCE_FILE_INVALID');
  }
  if (info.size <= 0 || info.size > MAX_EVIDENCE_BYTES) {
    throw new Error('AGENT_FRONTIER_EVIDENCE_SIZE_INVALID');
  }
  return parseEvidence(await readFile(filePath, 'utf8'));
}

async function main(): Promise<void> {
  const evidence = await loadEvidence(inputPath());
  const expectedSha = process.env.ORIGIN_AGENT_FRONTIER_CANDIDATE_SHA?.trim().toLowerCase();
  if (!expectedSha || !SHA40.test(expectedSha)) throw new Error('AGENT_FRONTIER_EXPECTED_SHA_REQUIRED');
  if (evidence.candidateSha.toLowerCase() !== expectedSha) {
    throw new Error('AGENT_FRONTIER_EVIDENCE_EXACT_SHA_MISMATCH');
  }

  const result = evaluateAgentFrontierTaskGateV3(evidence);
  const serialized = JSON.stringify(result, null, 2) + '\n';
  const output = outputPath();
  if (output) await writeFile(output, serialized, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(serialized);
  if (!result.passed) process.exitCode = 2;
}

main().catch((error: unknown) => {
  const code = error instanceof Error ? error.message : 'AGENT_FRONTIER_QUALIFICATION_FAILED';
  process.stderr.write(code + '\n');
  process.exitCode = 1;
});
