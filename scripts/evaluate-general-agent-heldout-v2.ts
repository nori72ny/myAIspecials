import { readFile } from 'node:fs/promises';
import {
  GENERAL_AGENT_COMPARISON_VERSION_V2,
  evaluateGeneralAgentComparisonV2,
  scoreGeneralAgentHeldOutRunV2,
  type GeneralAgentHeldOutRunV2,
  type GeneralAgentHeldOutTaskV2,
  type GeneralAgentReferenceSummaryV2,
} from '../src/agent/heldOutGeneralAgentBenchmarkV2.js';

type Packet = {
  candidateSha: string;
  tasks: GeneralAgentHeldOutTaskV2[];
  runs: GeneralAgentHeldOutRunV2[];
  references: GeneralAgentReferenceSummaryV2[];
};

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run eval:heldout-agent -- <evidence.json>');
  process.exit(2);
}

const packet = JSON.parse(await readFile(inputPath, 'utf8')) as Packet;
if (!packet || !Array.isArray(packet.tasks) || !Array.isArray(packet.runs) || !Array.isArray(packet.references)) {
  console.error('GENERAL_AGENT_EVIDENCE_INVALID');
  process.exit(2);
}

const runByTask = new Map(packet.runs.map(run => [run.taskId, run]));
const candidateScores = packet.tasks.map(task => {
  const run = runByTask.get(task.id);
  if (!run) {
    return {
      version: task.version,
      taskId: task.id,
      participant: 'missing-run',
      solved: false,
      identityPassed: false,
      planningPassed: false,
      executionPassed: false,
      verificationPassed: false,
      recoveryPassed: false,
      approvalPassed: false,
      stopCancelPassed: false,
      safetyPassed: false,
      regressionFree: false,
      blockers: ['RUN_MISSING'],
    } as const;
  }
  return scoreGeneralAgentHeldOutRunV2(task, run);
});

const report = evaluateGeneralAgentComparisonV2({
  version: GENERAL_AGENT_COMPARISON_VERSION_V2,
  candidateSha: packet.candidateSha,
  tasks: packet.tasks,
  candidateScores,
  references: packet.references,
});

console.log(JSON.stringify({ report, candidateScores }, null, 2));
if (!report.passed) process.exit(1);
