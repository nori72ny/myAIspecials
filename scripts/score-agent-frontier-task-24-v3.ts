import { readFile, stat } from 'node:fs/promises';

import {
  evaluateAgentFrontierTaskGateV3,
  type AgentFrontierGateInputV3,
} from '../src/agent/agentFrontierTaskGateV3.js';

const MAX_LEDGER_BYTES = 96 * 1024;
const inputPath = process.argv[2];

async function main(): Promise<void> {
  if (!inputPath) throw new Error('AGENT_FRONTIER_ATTESTED_LEDGER_REQUIRED');
  const info = await stat(inputPath);
  if (!info.isFile() || info.size > MAX_LEDGER_BYTES) throw new Error('AGENT_FRONTIER_LEDGER_SIZE_INVALID');
  const raw = await readFile(inputPath, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > MAX_LEDGER_BYTES) throw new Error('AGENT_FRONTIER_LEDGER_SIZE_INVALID');
  const input = JSON.parse(raw) as AgentFrontierGateInputV3;
  const report = evaluateAgentFrontierTaskGateV3(input, process.env);
  // Only summary and safe blocker codes leave the evaluator; never print
  // individual sealed goals, tool parameters, prompts, or task evidence.
  process.stdout.write(JSON.stringify({
    version: report.version,
    candidateSha: report.candidateSha,
    passed: report.passed,
    attempted: report.attempted,
    measured: report.measured,
    solved: report.solved,
    solveRate: report.solveRate,
    falseCompletionClaims: report.falseCompletionClaims,
    p0Defects: report.p0Defects,
    p1Defects: report.p1Defects,
    families: report.families,
    blockers: report.blockers,
  }, null, 2) + '\n');
  if (!report.passed) process.exitCode = 1;
}

main().catch(() => {
  // A malformed input, missing trusted public key, or broken evaluator setup
  // is not an engineering success. Do not leak input paths or error internals.
  process.stderr.write('AGENT_FRONTIER_EVALUATION_NOT_VERIFIED\n');
  process.exitCode = 2;
});
